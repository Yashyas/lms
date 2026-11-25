import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Redis } from "ioredis"

export interface AppNotification {
  id: string
  scope: 'GLOBAL' | 'COURSE' | 'USER'
  targetId?: string
  title: string
  message: string
  data?: Record<string, any>
  createdAt: string
}
export interface UserNotificationFeed {
  global: AppNotification[]
  courses: AppNotification[]
  user: AppNotification[]
}

@Injectable()
export class NotificationRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationRedisService.name)

  // Normal operation 
  private client!: Redis

  // Dedicated to listening to channels 
  private subClient!: Redis

  // Map of: channelName -> Set of user callbacks
  private channelListeners = new Map<string, Set<(notification: AppNotification) => void>>();

  private readonly MAX_HISTORY = 20

  constructor(private readonly config: ConfigService) { }

  onModuleInit() {
    const host = this.config.getOrThrow<string>('REDIS_HOST')
    const port = this.config.getOrThrow<number>('REDIS_PORT')
    // const password = this.config.getOrThrow<string>('REDIS_PASSWORD')

    this.client = new Redis({ host, port })
    this.subClient = new Redis({ host, port })

    this.client.on('error', (err) =>
      this.logger.error('redis client error:', err),
    )
    this.subClient.on('error', (err) =>
      this.logger.error('redis subClient error:', err),
    )
    // tell redis to listen to sse:* pattern (global, course, user)
    this.subClient.psubscribe('sse:*', (err) => {
      if (err) this.logger.error('Failed to psubscribe to sse:*', err)
    })
    // listen for messages on all channels starting with sse:*
    this.subClient.on('pmessage', (_pattern, channel, message) => {
      const listeners = this.channelListeners.get(channel)
      if (!listeners || listeners.size === 0) return

      try {
        const notification = JSON.parse(message)
        for (const callback of listeners) {
          callback(notification)
        }
      } catch {
        // ignore malformed json 
      }
    })

  }

  onModuleDestroy() {
    this.client?.disconnect()
    this.subClient?.disconnect()
  }

  getSubscriber(): Redis {
    return this.subClient
  }

  // push for global notification 
  async pushGlobal(notification: AppNotification): Promise<void> {
    const key = 'notification:global'
    const channel = 'sse:global'
    const payload = JSON.stringify(notification)

    // push to list and publish to global channel
    await this.client
      .pipeline()
      .lpush(key, payload)
      .ltrim(key, 0, this.MAX_HISTORY - 1)
      .publish(channel, payload)
      .exec()
  }

  // push for course notification 
  async pushCourse(courseId: string, notification: AppNotification): Promise<void> {
    const key = `notification:course:${courseId}`
    const channel = `sse:course:${courseId}`
    const payload = JSON.stringify(notification)

    // push to list and publish to course channel
    await this.client
      .pipeline()
      .lpush(key, payload)
      .ltrim(key, 0, this.MAX_HISTORY - 1)
      .expire(key, 30 * 24 * 60 * 60)
      .publish(channel, payload)
      .exec()
  }

  // push for user notification 
  async pushUser(userId: string, notification: AppNotification): Promise<void> {
    const key = `notification:user:${userId}`
    const channel = `sse:user:${userId}`
    const payload = JSON.stringify(notification)

    // push to list and publish to user channel
    await this.client
      .pipeline()
      .lpush(key, payload)
      .ltrim(key, 0, this.MAX_HISTORY - 1)
      .expire(key, 30 * 24 * 60 * 60)
      .publish(channel, payload)
      .exec()
  }

  async getRecentForUser(userId: string, enrolledCourseIds: string[] = []): Promise<UserNotificationFeed> {
    const pipeline = this.client.pipeline()
    // fetch global notification only last 20
    pipeline.lrange('notification:global', 0, this.MAX_HISTORY - 1)
    // fetch user notification only last 20
    pipeline.lrange(`notification:user:${userId}`, 0, this.MAX_HISTORY - 1)

    // fetch for all enrolled courses only last 20
    for (const courseId of enrolledCourseIds) {
      pipeline.lrange(`notification:course:${courseId}`, 0, this.MAX_HISTORY - 1)
    }

    const results = await pipeline.exec()

    if (!results) {
      return { global: [], courses: [], user: [] }
    }

    // function to parse list to strings if not already parsed
    const parseList = (raw: unknown): AppNotification[] => {
      if (!Array.isArray(raw)) {
        return []
      }
      return raw.map((s) => JSON.parse(s as string))
    }

    const [rawGlobal, rawUser, ...courseResults] = results

    // rawGlobal[1] is used because pipeline.exec() return {error,result} so second index gives result
    const global = parseList(rawGlobal?.[1])
    const user = parseList(rawUser?.[1])
    const courses = courseResults.flatMap(([, list]) => parseList(list))

    courses.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { global, courses: courses.slice(0, this.MAX_HISTORY), user }
  }

  // registers a user sse and retuns teardown function on disconnect 

  subscribeUser(channels: string[], callback: (notification: AppNotification) => void,): () => void {
    // Add the callback to each channel
    for (const channel of channels) {
      if (!this.channelListeners.has(channel)) {
        this.channelListeners.set(channel, new Set());
      }
      this.channelListeners.get(channel)!.add(callback);
    }
    //Return the cleanup function for when the user disconnects / closes tab
    return () => {
      for (const channel of channels) {
        const set = this.channelListeners.get(channel);
        if (set) {
          set.delete(callback);
          // If no one is listening to this channel anymore, free the Map entry
          if (set.size === 0) {
            this.channelListeners.delete(channel);
          }
        }
      }
    };
  }

}