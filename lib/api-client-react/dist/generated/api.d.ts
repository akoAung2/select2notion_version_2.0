import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AiActionResult, AiChatInput, AiConfirmInput, AiVoiceInput, AiVoiceResult, ChatReply, DeleteTrade200, GetTrades200, HealthStatus, NotificationSettings, NotificationSettingsInput, NotionAutoDetectInput, NotionAutoDetectResult, NotionConnectionStatus, NotionConnectionTest, NotionOAuthPendingResult, NotionSchemaResponse, OAuthStartInfo, SaveNotificationSettings200, Trade, TradeInput, TriggerDailyReminder200, TriggerWeeklyReport200 } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetTradesUrl: () => string;
/**
 * @summary List all trades
 */
export declare const getTrades: (options?: RequestInit) => Promise<GetTrades200>;
export declare const getGetTradesQueryKey: () => readonly ["/api/trades"];
export declare const getGetTradesQueryOptions: <TData = Awaited<ReturnType<typeof getTrades>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTrades>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTrades>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTradesQueryResult = NonNullable<Awaited<ReturnType<typeof getTrades>>>;
export type GetTradesQueryError = ErrorType<unknown>;
/**
 * @summary List all trades
 */
export declare function useGetTrades<TData = Awaited<ReturnType<typeof getTrades>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTrades>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateTradeUrl: () => string;
/**
 * @summary Create a trade
 */
export declare const createTrade: (tradeInput: TradeInput, options?: RequestInit) => Promise<Trade>;
export declare const getCreateTradeMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createTrade>>, TError, {
        data: BodyType<TradeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createTrade>>, TError, {
    data: BodyType<TradeInput>;
}, TContext>;
export type CreateTradeMutationResult = NonNullable<Awaited<ReturnType<typeof createTrade>>>;
export type CreateTradeMutationBody = BodyType<TradeInput>;
export type CreateTradeMutationError = ErrorType<unknown>;
/**
* @summary Create a trade
*/
export declare const useCreateTrade: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createTrade>>, TError, {
        data: BodyType<TradeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createTrade>>, TError, {
    data: BodyType<TradeInput>;
}, TContext>;
export declare const getUpdateTradeUrl: (id: string) => string;
/**
 * @summary Update a trade
 */
export declare const updateTrade: (id: string, tradeInput: TradeInput, options?: RequestInit) => Promise<Trade>;
export declare const getUpdateTradeMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateTrade>>, TError, {
        id: string;
        data: BodyType<TradeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateTrade>>, TError, {
    id: string;
    data: BodyType<TradeInput>;
}, TContext>;
export type UpdateTradeMutationResult = NonNullable<Awaited<ReturnType<typeof updateTrade>>>;
export type UpdateTradeMutationBody = BodyType<TradeInput>;
export type UpdateTradeMutationError = ErrorType<unknown>;
/**
* @summary Update a trade
*/
export declare const useUpdateTrade: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateTrade>>, TError, {
        id: string;
        data: BodyType<TradeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateTrade>>, TError, {
    id: string;
    data: BodyType<TradeInput>;
}, TContext>;
export declare const getDeleteTradeUrl: (id: string) => string;
/**
 * @summary Delete a trade
 */
export declare const deleteTrade: (id: string, options?: RequestInit) => Promise<DeleteTrade200>;
export declare const getDeleteTradeMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteTrade>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteTrade>>, TError, {
    id: string;
}, TContext>;
export type DeleteTradeMutationResult = NonNullable<Awaited<ReturnType<typeof deleteTrade>>>;
export type DeleteTradeMutationError = ErrorType<unknown>;
/**
* @summary Delete a trade
*/
export declare const useDeleteTrade: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteTrade>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteTrade>>, TError, {
    id: string;
}, TContext>;
export declare const getGetNotionSchemaUrl: () => string;
/**
 * @summary Get Notion database schema
 */
export declare const getNotionSchema: (options?: RequestInit) => Promise<NotionSchemaResponse>;
export declare const getGetNotionSchemaQueryKey: () => readonly ["/api/notion/schema"];
export declare const getGetNotionSchemaQueryOptions: <TData = Awaited<ReturnType<typeof getNotionSchema>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNotionSchema>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getNotionSchema>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetNotionSchemaQueryResult = NonNullable<Awaited<ReturnType<typeof getNotionSchema>>>;
export type GetNotionSchemaQueryError = ErrorType<unknown>;
/**
 * @summary Get Notion database schema
 */
export declare function useGetNotionSchema<TData = Awaited<ReturnType<typeof getNotionSchema>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNotionSchema>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getTestNotionConnectionUrl: () => string;
/**
 * @summary Test Notion connection
 */
export declare const testNotionConnection: (notionConnectionTest: NotionConnectionTest, options?: RequestInit) => Promise<NotionConnectionStatus>;
export declare const getTestNotionConnectionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof testNotionConnection>>, TError, {
        data: BodyType<NotionConnectionTest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof testNotionConnection>>, TError, {
    data: BodyType<NotionConnectionTest>;
}, TContext>;
export type TestNotionConnectionMutationResult = NonNullable<Awaited<ReturnType<typeof testNotionConnection>>>;
export type TestNotionConnectionMutationBody = BodyType<NotionConnectionTest>;
export type TestNotionConnectionMutationError = ErrorType<unknown>;
/**
* @summary Test Notion connection
*/
export declare const useTestNotionConnection: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof testNotionConnection>>, TError, {
        data: BodyType<NotionConnectionTest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof testNotionConnection>>, TError, {
    data: BodyType<NotionConnectionTest>;
}, TContext>;
export declare const getAutoDetectNotionUrl: () => string;
/**
 * @summary Auto-detect Notion database
 */
export declare const autoDetectNotion: (notionAutoDetectInput: NotionAutoDetectInput, options?: RequestInit) => Promise<NotionAutoDetectResult>;
export declare const getAutoDetectNotionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof autoDetectNotion>>, TError, {
        data: BodyType<NotionAutoDetectInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof autoDetectNotion>>, TError, {
    data: BodyType<NotionAutoDetectInput>;
}, TContext>;
export type AutoDetectNotionMutationResult = NonNullable<Awaited<ReturnType<typeof autoDetectNotion>>>;
export type AutoDetectNotionMutationBody = BodyType<NotionAutoDetectInput>;
export type AutoDetectNotionMutationError = ErrorType<unknown>;
/**
* @summary Auto-detect Notion database
*/
export declare const useAutoDetectNotion: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof autoDetectNotion>>, TError, {
        data: BodyType<NotionAutoDetectInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof autoDetectNotion>>, TError, {
    data: BodyType<NotionAutoDetectInput>;
}, TContext>;
export declare const getNotionOAuthStartUrl: () => string;
/**
 * @summary Start Notion OAuth flow
 */
export declare const notionOAuthStart: (options?: RequestInit) => Promise<OAuthStartInfo>;
export declare const getNotionOAuthStartQueryKey: () => readonly ["/api/notion/oauth/start"];
export declare const getNotionOAuthStartQueryOptions: <TData = Awaited<ReturnType<typeof notionOAuthStart>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof notionOAuthStart>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof notionOAuthStart>>, TError, TData> & {
    queryKey: QueryKey;
};
export type NotionOAuthStartQueryResult = NonNullable<Awaited<ReturnType<typeof notionOAuthStart>>>;
export type NotionOAuthStartQueryError = ErrorType<unknown>;
/**
 * @summary Start Notion OAuth flow
 */
export declare function useNotionOAuthStart<TData = Awaited<ReturnType<typeof notionOAuthStart>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof notionOAuthStart>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetNotionOAuthPendingUrl: () => string;
/**
 * @summary Poll for pending OAuth result
 */
export declare const getNotionOAuthPending: (options?: RequestInit) => Promise<NotionOAuthPendingResult>;
export declare const getGetNotionOAuthPendingQueryKey: () => readonly ["/api/notion/oauth/pending"];
export declare const getGetNotionOAuthPendingQueryOptions: <TData = Awaited<ReturnType<typeof getNotionOAuthPending>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNotionOAuthPending>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getNotionOAuthPending>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetNotionOAuthPendingQueryResult = NonNullable<Awaited<ReturnType<typeof getNotionOAuthPending>>>;
export type GetNotionOAuthPendingQueryError = ErrorType<unknown>;
/**
 * @summary Poll for pending OAuth result
 */
export declare function useGetNotionOAuthPending<TData = Awaited<ReturnType<typeof getNotionOAuthPending>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNotionOAuthPending>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getAiChatUrl: () => string;
/**
 * @summary Send message to AI trading coach
 */
export declare const aiChat: (aiChatInput: AiChatInput, options?: RequestInit) => Promise<ChatReply>;
export declare const getAiChatMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof aiChat>>, TError, {
        data: BodyType<AiChatInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof aiChat>>, TError, {
    data: BodyType<AiChatInput>;
}, TContext>;
export type AiChatMutationResult = NonNullable<Awaited<ReturnType<typeof aiChat>>>;
export type AiChatMutationBody = BodyType<AiChatInput>;
export type AiChatMutationError = ErrorType<unknown>;
/**
* @summary Send message to AI trading coach
*/
export declare const useAiChat: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof aiChat>>, TError, {
        data: BodyType<AiChatInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof aiChat>>, TError, {
    data: BodyType<AiChatInput>;
}, TContext>;
export declare const getAiConfirmActionUrl: () => string;
/**
 * @summary Confirm a pending AI action
 */
export declare const aiConfirmAction: (aiConfirmInput: AiConfirmInput, options?: RequestInit) => Promise<AiActionResult>;
export declare const getAiConfirmActionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof aiConfirmAction>>, TError, {
        data: BodyType<AiConfirmInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof aiConfirmAction>>, TError, {
    data: BodyType<AiConfirmInput>;
}, TContext>;
export type AiConfirmActionMutationResult = NonNullable<Awaited<ReturnType<typeof aiConfirmAction>>>;
export type AiConfirmActionMutationBody = BodyType<AiConfirmInput>;
export type AiConfirmActionMutationError = ErrorType<unknown>;
/**
* @summary Confirm a pending AI action
*/
export declare const useAiConfirmAction: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof aiConfirmAction>>, TError, {
        data: BodyType<AiConfirmInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof aiConfirmAction>>, TError, {
    data: BodyType<AiConfirmInput>;
}, TContext>;
export declare const getAiVoiceUrl: () => string;
/**
 * @summary Transcribe voice audio
 */
export declare const aiVoice: (aiVoiceInput: AiVoiceInput, options?: RequestInit) => Promise<AiVoiceResult>;
export declare const getAiVoiceMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof aiVoice>>, TError, {
        data: BodyType<AiVoiceInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof aiVoice>>, TError, {
    data: BodyType<AiVoiceInput>;
}, TContext>;
export type AiVoiceMutationResult = NonNullable<Awaited<ReturnType<typeof aiVoice>>>;
export type AiVoiceMutationBody = BodyType<AiVoiceInput>;
export type AiVoiceMutationError = ErrorType<unknown>;
/**
* @summary Transcribe voice audio
*/
export declare const useAiVoice: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof aiVoice>>, TError, {
        data: BodyType<AiVoiceInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof aiVoice>>, TError, {
    data: BodyType<AiVoiceInput>;
}, TContext>;
export declare const getGetNotificationSettingsUrl: () => string;
/**
 * @summary Get notification settings
 */
export declare const getNotificationSettings: (options?: RequestInit) => Promise<NotificationSettings>;
export declare const getGetNotificationSettingsQueryKey: () => readonly ["/api/notification-settings"];
export declare const getGetNotificationSettingsQueryOptions: <TData = Awaited<ReturnType<typeof getNotificationSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNotificationSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getNotificationSettings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetNotificationSettingsQueryResult = NonNullable<Awaited<ReturnType<typeof getNotificationSettings>>>;
export type GetNotificationSettingsQueryError = ErrorType<unknown>;
/**
 * @summary Get notification settings
 */
export declare function useGetNotificationSettings<TData = Awaited<ReturnType<typeof getNotificationSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNotificationSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSaveNotificationSettingsUrl: () => string;
/**
 * @summary Save notification settings
 */
export declare const saveNotificationSettings: (notificationSettingsInput: NotificationSettingsInput, options?: RequestInit) => Promise<SaveNotificationSettings200>;
export declare const getSaveNotificationSettingsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveNotificationSettings>>, TError, {
        data: BodyType<NotificationSettingsInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof saveNotificationSettings>>, TError, {
    data: BodyType<NotificationSettingsInput>;
}, TContext>;
export type SaveNotificationSettingsMutationResult = NonNullable<Awaited<ReturnType<typeof saveNotificationSettings>>>;
export type SaveNotificationSettingsMutationBody = BodyType<NotificationSettingsInput>;
export type SaveNotificationSettingsMutationError = ErrorType<unknown>;
/**
* @summary Save notification settings
*/
export declare const useSaveNotificationSettings: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveNotificationSettings>>, TError, {
        data: BodyType<NotificationSettingsInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof saveNotificationSettings>>, TError, {
    data: BodyType<NotificationSettingsInput>;
}, TContext>;
export declare const getTriggerDailyReminderUrl: () => string;
/**
 * @summary Trigger daily reminder email
 */
export declare const triggerDailyReminder: (options?: RequestInit) => Promise<TriggerDailyReminder200>;
export declare const getTriggerDailyReminderMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof triggerDailyReminder>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof triggerDailyReminder>>, TError, void, TContext>;
export type TriggerDailyReminderMutationResult = NonNullable<Awaited<ReturnType<typeof triggerDailyReminder>>>;
export type TriggerDailyReminderMutationError = ErrorType<unknown>;
/**
* @summary Trigger daily reminder email
*/
export declare const useTriggerDailyReminder: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof triggerDailyReminder>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof triggerDailyReminder>>, TError, void, TContext>;
export declare const getTriggerWeeklyReportUrl: () => string;
/**
 * @summary Trigger weekly report email
 */
export declare const triggerWeeklyReport: (options?: RequestInit) => Promise<TriggerWeeklyReport200>;
export declare const getTriggerWeeklyReportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof triggerWeeklyReport>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof triggerWeeklyReport>>, TError, void, TContext>;
export type TriggerWeeklyReportMutationResult = NonNullable<Awaited<ReturnType<typeof triggerWeeklyReport>>>;
export type TriggerWeeklyReportMutationError = ErrorType<unknown>;
/**
* @summary Trigger weekly report email
*/
export declare const useTriggerWeeklyReport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof triggerWeeklyReport>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof triggerWeeklyReport>>, TError, void, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map