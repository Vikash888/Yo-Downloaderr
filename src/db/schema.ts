import { bigint, boolean, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { PlaylistData } from "@/lib/types";

export const playlistPreviews = pgTable(
  "playlist_previews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerToken: text("owner_token").notNull(),
    sourceUrl: text("source_url").notNull(),
    payload: jsonb("payload").$type<PlaylistData>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("playlist_previews_owner_idx").on(table.ownerToken, table.createdAt)],
);

export const downloadJobs = pgTable(
  "download_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerToken: text("owner_token").notNull(),
    sourceUrl: text("source_url").notNull(),
    playlistTitle: text("playlist_title").notNull(),
    channelTitle: text("channel_title").notNull(),
    status: text("status").notNull().default("queued"),
    format: text("format").notNull(),
    quality: text("quality").notNull(),
    delivery: text("delivery").notNull(),
    embedMetadata: boolean("embed_metadata").notNull().default(true),
    embedThumbnail: boolean("embed_thumbnail").notNull().default(true),
    rightsConfirmed: boolean("rights_confirmed").notNull().default(false),
    totalItems: integer("total_items").notNull().default(0),
    totalDuration: integer("total_duration").notNull().default(0),
    zipPath: text("zip_path"),
    zipFileName: text("zip_file_name"),
    zipSize: bigint("zip_size", { mode: "number" }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("download_jobs_owner_idx").on(table.ownerToken, table.createdAt)],
);

export const downloadItems = pgTable(
  "download_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => downloadJobs.id, { onDelete: "cascade" }),
    videoId: text("video_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    duration: integer("duration"),
    thumbnailUrl: text("thumbnail_url").notNull(),
    status: text("status").notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    skipReason: text("skip_reason"),
    filePath: text("file_path"),
    fileName: text("file_name"),
    fileSize: bigint("file_size", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("download_items_job_idx").on(table.jobId, table.position)],
);

export type DownloadJobRow = typeof downloadJobs.$inferSelect;
export type DownloadItemRow = typeof downloadItems.$inferSelect;
