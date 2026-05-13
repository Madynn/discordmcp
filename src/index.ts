import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from 'dotenv';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, GatewayIntentBits, TextChannel, ChannelType, CategoryChannel, GuildChannel } from 'discord.js';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Helper function to find a guild by name or ID
async function findGuild(guildIdentifier?: string) {
  if (!guildIdentifier) {
    // If no guild specified and bot is only in one guild, use that
    if (client.guilds.cache.size === 1) {
      return client.guilds.cache.first()!;
    }
    // List available guilds
    const guildList = Array.from(client.guilds.cache.values())
      .map(g => `"${g.name}"`).join(', ');
    throw new Error(`Bot is in multiple servers. Please specify server name or ID. Available servers: ${guildList}`);
  }

  // Try to fetch by ID first
  try {
    const guild = await client.guilds.fetch(guildIdentifier);
    if (guild) return guild;
  } catch {
    // If ID fetch fails, search by name
    const guilds = client.guilds.cache.filter(
      g => g.name.toLowerCase() === guildIdentifier.toLowerCase()
    );
    
    if (guilds.size === 0) {
      const availableGuilds = Array.from(client.guilds.cache.values())
        .map(g => `"${g.name}"`).join(', ');
      throw new Error(`Server "${guildIdentifier}" not found. Available servers: ${availableGuilds}`);
    }
    if (guilds.size > 1) {
      const guildList = guilds.map(g => `${g.name} (ID: ${g.id})`).join(', ');
      throw new Error(`Multiple servers found with name "${guildIdentifier}": ${guildList}. Please specify the server ID.`);
    }
    return guilds.first()!;
  }
  throw new Error(`Server "${guildIdentifier}" not found`);
}

// Helper function to find a channel by name or ID within a specific guild
async function findChannel(channelIdentifier: string, guildIdentifier?: string): Promise<TextChannel> {
  const guild = await findGuild(guildIdentifier);
  
  // First try to fetch by ID
  try {
    const channel = await client.channels.fetch(channelIdentifier);
    if (channel instanceof TextChannel && channel.guild.id === guild.id) {
      return channel;
    }
  } catch {
    // If fetching by ID fails, search by name in the specified guild
    const channels = guild.channels.cache.filter(
      (channel): channel is TextChannel =>
        channel instanceof TextChannel &&
        (channel.name.toLowerCase() === channelIdentifier.toLowerCase() ||
         channel.name.toLowerCase() === channelIdentifier.toLowerCase().replace('#', ''))
    );

    if (channels.size === 0) {
      const availableChannels = guild.channels.cache
        .filter((c): c is TextChannel => c instanceof TextChannel)
        .map(c => `"#${c.name}"`).join(', ');
      throw new Error(`Channel "${channelIdentifier}" not found in server "${guild.name}". Available channels: ${availableChannels}`);
    }
    if (channels.size > 1) {
      const channelList = channels.map(c => `#${c.name} (${c.id})`).join(', ');
      throw new Error(`Multiple channels found with name "${channelIdentifier}" in server "${guild.name}": ${channelList}. Please specify the channel ID.`);
    }
    return channels.first()!;
  }
  throw new Error(`Channel "${channelIdentifier}" is not a text channel or not found in server "${guild.name}"`);
}

// Updated validation schemas
const SendMessageSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
  channel: z.string().describe('Channel name (e.g., "general") or ID'),
  message: z.string(),
});

const ReadMessagesSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
  channel: z.string().describe('Channel name (e.g., "general") or ID'),
  limit: z.number().min(1).max(100).default(50),
});

// ─── Channel management schemas ────────────────────────────────
const ListChannelsSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
});

const CreateCategorySchema = z.object({
  server: z.string().optional(),
  name: z.string().describe('Category name (displayed in uppercase by Discord). Ex: "INFO" or "── INFO ──"'),
  position: z.number().int().optional().describe('Position in sidebar (0 = top). Optional.'),
});

const CreateChannelSchema = z.object({
  server: z.string().optional(),
  name: z.string().describe('Channel name (lowercase, dashes only). Ex: "bug-reports"'),
  type: z.enum(['text', 'voice']).default('text'),
  category: z.string().optional().describe('Category name or ID to place the channel in. Optional.'),
  topic: z.string().optional().describe('Channel topic / description (text channels only). Optional.'),
});

const DeleteChannelSchema = z.object({
  server: z.string().optional(),
  channel: z.string().describe('Channel name or ID to delete'),
  is_category: z.boolean().default(false).describe('Set true to delete a category (and free its children, not delete them)'),
});

const RenameChannelSchema = z.object({
  server: z.string().optional(),
  channel: z.string().describe('Channel/category name or ID to rename'),
  new_name: z.string().describe('New name'),
});

const SetChannelTopicSchema = z.object({
  server: z.string().optional(),
  channel: z.string().describe('Text channel name or ID'),
  topic: z.string().describe('New topic text (max 1024 chars)'),
});

// Create server instance
const server = new Server(
  {
    name: "discord",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "send-message",
        description: "Send a message to a Discord channel",
        inputSchema: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: 'Server name or ID (optional if bot is only in one server)',
            },
            channel: {
              type: "string",
              description: 'Channel name (e.g., "general") or ID',
            },
            message: {
              type: "string",
              description: "Message content to send",
            },
          },
          required: ["channel", "message"],
        },
      },
      {
        name: "read-messages",
        description: "Read recent messages from a Discord channel",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: 'Server name or ID (optional if bot is only in one server)' },
            channel: { type: "string", description: 'Channel name (e.g., "general") or ID' },
            limit: { type: "number", description: "Number of messages to fetch (max 100)", default: 50 },
          },
          required: ["channel"],
        },
      },
      {
        name: "list-channels",
        description: "List all categories and channels of a Discord server, organized hierarchically. Useful before creating channels to avoid duplicates and to find category IDs.",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: 'Server name or ID (optional if bot is only in one server)' },
          },
        },
      },
      {
        name: "create-category",
        description: "Create a new category (channel group) in a Discord server. Categories visually group channels in the sidebar.",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" },
            name: { type: "string", description: 'Category name. Discord displays it uppercase. Ex: "INFO"' },
            position: { type: "number", description: "Position in sidebar (0 = top). Optional." },
          },
          required: ["name"],
        },
      },
      {
        name: "create-channel",
        description: "Create a text or voice channel in a Discord server, optionally inside a category.",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" },
            name: { type: "string", description: 'Channel name (lowercase, dashes). Ex: "bug-reports"' },
            type: { type: "string", enum: ["text", "voice"], default: "text" },
            category: { type: "string", description: "Category name or ID to place the channel in. Optional." },
            topic: { type: "string", description: "Channel description (text channels only). Optional." },
          },
          required: ["name"],
        },
      },
      {
        name: "delete-channel",
        description: "Delete a channel or category. WARNING: irreversible. Deleting a category does not delete its children, they become orphans.",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" },
            channel: { type: "string", description: "Channel/category name or ID" },
            is_category: { type: "boolean", default: false, description: "Set true if target is a category" },
          },
          required: ["channel"],
        },
      },
      {
        name: "rename-channel",
        description: "Rename a channel or category.",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" },
            channel: { type: "string", description: "Channel/category name or ID" },
            new_name: { type: "string" },
          },
          required: ["channel", "new_name"],
        },
      },
      {
        name: "set-channel-topic",
        description: "Set the topic (description) of a text channel.",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" },
            channel: { type: "string" },
            topic: { type: "string", description: "New topic text (max 1024 chars)" },
          },
          required: ["channel", "topic"],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "send-message": {
        const { channel: channelIdentifier, message } = SendMessageSchema.parse(args);
        const channel = await findChannel(channelIdentifier);
        
        const sent = await channel.send(message);
        return {
          content: [{
            type: "text",
            text: `Message sent successfully to #${channel.name} in ${channel.guild.name}. Message ID: ${sent.id}`,
          }],
        };
      }

      case "read-messages": {
        const { channel: channelIdentifier, limit } = ReadMessagesSchema.parse(args);
        const channel = await findChannel(channelIdentifier);

        const messages = await channel.messages.fetch({ limit });
        const formattedMessages = Array.from(messages.values()).map(msg => ({
          channel: `#${channel.name}`,
          server: channel.guild.name,
          author: msg.author.tag,
          content: msg.content,
          timestamp: msg.createdAt.toISOString(),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify(formattedMessages, null, 2),
          }],
        };
      }

      case "list-channels": {
        const { server: srv } = ListChannelsSchema.parse(args);
        const guild = await findGuild(srv);
        await guild.channels.fetch();

        const cats = Array.from(guild.channels.cache.values())
          .filter(c => c.type === ChannelType.GuildCategory)
          .sort((a, b) => (a as any).position - (b as any).position);

        const result: any = { server: guild.name, categories: [], orphans: [] };
        for (const cat of cats) {
          const children = Array.from(guild.channels.cache.values())
            .filter(c => c.parentId === cat.id)
            .sort((a, b) => (a as any).position - (b as any).position)
            .map(c => ({
              id: c.id,
              name: c.name,
              type: c.type === ChannelType.GuildVoice ? "voice"
                  : c.type === ChannelType.GuildText ? "text"
                  : `other(${c.type})`,
            }));
          result.categories.push({ id: cat.id, name: cat.name, children });
        }

        result.orphans = Array.from(guild.channels.cache.values())
          .filter(c => c.type !== ChannelType.GuildCategory && !c.parentId)
          .sort((a, b) => (a as any).position - (b as any).position)
          .map(c => ({
            id: c.id,
            name: c.name,
            type: c.type === ChannelType.GuildVoice ? "voice"
                : c.type === ChannelType.GuildText ? "text"
                : `other(${c.type})`,
          }));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "create-category": {
        const { server: srv, name: catName, position } = CreateCategorySchema.parse(args);
        const guild = await findGuild(srv);
        const created = await guild.channels.create({
          name: catName,
          type: ChannelType.GuildCategory,
          position,
        });
        return {
          content: [{
            type: "text",
            text: `Category created: "${created.name}" (ID: ${created.id})`,
          }],
        };
      }

      case "create-channel": {
        const { server: srv, name: chName, type: chType, category, topic } = CreateChannelSchema.parse(args);
        const guild = await findGuild(srv);

        let parentId: string | undefined;
        let parentName: string | undefined;
        if (category) {
          await guild.channels.fetch();
          const catChannel = guild.channels.cache.find(c =>
            c.type === ChannelType.GuildCategory &&
            (c.id === category || c.name.toLowerCase() === category.toLowerCase())
          );
          if (!catChannel) {
            const availableCats = guild.channels.cache
              .filter(c => c.type === ChannelType.GuildCategory)
              .map(c => `"${c.name}"`).join(", ");
            throw new Error(`Category "${category}" not found. Available: ${availableCats || "(none)"}`);
          }
          parentId = catChannel.id;
          parentName = catChannel.name;
        }

        const created = await guild.channels.create({
          name: chName,
          type: chType === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText,
          parent: parentId,
          topic: chType === "text" ? topic : undefined,
        });

        return {
          content: [{
            type: "text",
            text: `Channel created: #${created.name} (${chType}, ID: ${created.id})${parentName ? ` in category "${parentName}"` : " (no category)"}`,
          }],
        };
      }

      case "delete-channel": {
        const { server: srv, channel: chIdent, is_category } = DeleteChannelSchema.parse(args);
        const guild = await findGuild(srv);
        await guild.channels.fetch();

        const target = guild.channels.cache.find(c => {
          if (c.id === chIdent) return true;
          if (is_category) {
            return c.type === ChannelType.GuildCategory && c.name.toLowerCase() === chIdent.toLowerCase();
          }
          return c.type !== ChannelType.GuildCategory && c.name.toLowerCase() === chIdent.toLowerCase();
        });
        if (!target) throw new Error(`${is_category ? "Category" : "Channel"} "${chIdent}" not found`);

        const deletedName = target.name;
        const deletedType = target.type === ChannelType.GuildCategory ? "category" : "channel";
        await target.delete();

        return {
          content: [{
            type: "text",
            text: `${deletedType === "category" ? "Category" : "Channel"} "${deletedName}" deleted.`,
          }],
        };
      }

      case "rename-channel": {
        const { server: srv, channel: chIdent, new_name } = RenameChannelSchema.parse(args);
        const guild = await findGuild(srv);
        await guild.channels.fetch();

        const target = guild.channels.cache.find(c =>
          c.id === chIdent || c.name.toLowerCase() === chIdent.toLowerCase()
        );
        if (!target) throw new Error(`Channel/category "${chIdent}" not found`);

        const oldName = target.name;
        await (target as GuildChannel).setName(new_name);

        return {
          content: [{
            type: "text",
            text: `Renamed "${oldName}" -> "${new_name}"`,
          }],
        };
      }

      case "set-channel-topic": {
        const { server: srv, channel: chIdent, topic: newTopic } = SetChannelTopicSchema.parse(args);
        const channel = await findChannel(chIdent, srv);
        await channel.setTopic(newTopic);

        return {
          content: [{
            type: "text",
            text: `Topic set on #${channel.name}: "${newTopic.substring(0, 80)}${newTopic.length > 80 ? "..." : ""}"`,
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }
    // Pretty error for Discord permission denied (50013)
    if (error?.code === 50013) {
      throw new Error(
        `Permission denied (Discord 50013): the bot lacks the required permission. ` +
        `Open Server Settings > Roles > [bot role] > Permissions and enable: ` +
        `"Manage Channels" (and possibly "View Channels", "Manage Roles"). ` +
        `Original: ${error.message}`
      );
    }
    throw error;
  }
});

// Discord client login and error handling
client.once('ready', () => {
  console.error('Discord bot is ready!');
});

// Start the server
async function main() {
  // Check for Discord token
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN environment variable is not set');
  }
  
  try {
    // Login to Discord
    await client.login(token);

    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Discord MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

main();