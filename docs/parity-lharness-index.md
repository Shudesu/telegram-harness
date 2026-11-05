# L Harness 棚卸し補助索引

[判定表](parity-lharness.md)の機能IDに対応。実装の存在を示す索引であり、本番での有効化・動作保証ではない。ソースコード本文の複製なし。

| 種別・元ファイル | 判定表ID | HTTP入口数 |
|---|---|---|
| `apps/worker/src/durable-objects/tenant-scheduler.ts` | F30 | — |
| `apps/worker/src/index.ts` | F30 | 5 |
| `apps/worker/src/routes/account-settings.ts` | F27 | 6 |
| `apps/worker/src/routes/ad-platforms.ts` | F24 | 6 |
| `apps/worker/src/routes/admin-auth.ts` | F28 | 3 |
| `apps/worker/src/routes/admin-sso.ts` | F28 | 1 |
| `apps/worker/src/routes/admin-update.ts` | F29 | 4 |
| `apps/worker/src/routes/admin-version.ts` | F29 | 2 |
| `apps/worker/src/routes/affiliate-offers.ts` | F25 | 4 |
| `apps/worker/src/routes/affiliate-self.ts` | F25 | 6 |
| `apps/worker/src/routes/affiliates.ts` | F25 | 11 |
| `apps/worker/src/routes/auto-replies.ts` | F05 | 5 |
| `apps/worker/src/routes/automations.ts` | F18 | 6 |
| `apps/worker/src/routes/booking.ts` | F11 | 32 |
| `apps/worker/src/routes/broadcasts.ts` | F04 | 14 |
| `apps/worker/src/routes/calendar.ts` | F11 | 7 |
| `apps/worker/src/routes/capabilities.ts` | F30 | 1 |
| `apps/worker/src/routes/chats.ts` | F21 | 10 |
| `apps/worker/src/routes/conversations.ts` | F21 | 2 |
| `apps/worker/src/routes/conversions.ts` | F23 | 8 |
| `apps/worker/src/routes/dedup-preview.ts` | F04 | 1 |
| `apps/worker/src/routes/duplicates.ts` | F01 | 1 |
| `apps/worker/src/routes/entry-routes.ts` | F10 | 6 |
| `apps/worker/src/routes/events.ts` | F12 | 20 |
| `apps/worker/src/routes/forms.ts` | F08 | 9 |
| `apps/worker/src/routes/friends.ts` | F01 | 10 |
| `apps/worker/src/routes/health.ts` | F30 | 6 |
| `apps/worker/src/routes/images.ts` | F22 | 3 |
| `apps/worker/src/routes/inbox.ts` | F21 | 3 |
| `apps/worker/src/routes/instagram-engagement.ts` | F32 | 1 |
| `apps/worker/src/routes/liff.ts` | F08 | 10 |
| `apps/worker/src/routes/line-accounts.ts` | F27 | 13 |
| `apps/worker/src/routes/line-proxy.ts` | F31 | 2 |
| `apps/worker/src/routes/live-games.ts` | F26 | 11 |
| `apps/worker/src/routes/media-inquiries.ts` | F33 | 1 |
| `apps/worker/src/routes/meet-callback.ts` | F13 | 1 |
| `apps/worker/src/routes/meet-consultations.ts` | F13 | 3 |
| `apps/worker/src/routes/message-templates.ts` | F06 | 5 |
| `apps/worker/src/routes/notifications.ts` | F20 | 6 |
| `apps/worker/src/routes/openapi.ts` | F30 | 2 |
| `apps/worker/src/routes/profile-refresh.ts` | F01 | 10 |
| `apps/worker/src/routes/reminders.ts` | F14 | 10 |
| `apps/worker/src/routes/rich-menu-groups.ts` | F07 | 14 |
| `apps/worker/src/routes/rich-menus.ts` | F07 | 8 |
| `apps/worker/src/routes/scenarios.ts` | F03 | 13 |
| `apps/worker/src/routes/scoring.ts` | F17 | 13 |
| `apps/worker/src/routes/setup.ts` | F30 | 1 |
| `apps/worker/src/routes/six-games.ts` | F26 | 13 |
| `apps/worker/src/routes/staff.ts` | F28 | 7 |
| `apps/worker/src/routes/stripe.ts` | F16 | 2 |
| `apps/worker/src/routes/tags.ts` | F02 | 4 |
| `apps/worker/src/routes/templates.ts` | F06 | 6 |
| `apps/worker/src/routes/tracked-links.ts` | F09 | 6 |
| `apps/worker/src/routes/traffic-pools.ts` | F10 | 9 |
| `apps/worker/src/routes/usage.ts` | F30 | 1 |
| `apps/worker/src/routes/users-grouped.ts` | F01 | 1 |
| `apps/worker/src/routes/users.ts` | F01 | 8 |
| `apps/worker/src/routes/webhook.ts` | F19 | 1 |
| `apps/worker/src/routes/webhooks.ts` | F19 | 9 |
| `apps/worker/src/routes/webinars.ts` | F15 | 22 |
| `apps/worker/src/scheduled.ts` | F30 | — |
| `apps/worker/src/services/activity-digest.ts` | F20 | — |
| `apps/worker/src/services/activity-mileage.ts` | F35 | — |
| `apps/worker/src/services/ad-conversion.ts` | F24 | — |
| `apps/worker/src/services/affiliate-notifier.ts` | F25 | — |
| `apps/worker/src/services/auto-reply.ts` | F05 | — |
| `apps/worker/src/services/auto-track.ts` | F09 | — |
| `apps/worker/src/services/availability.ts` | F11 | — |
| `apps/worker/src/services/ban-monitor.ts` | F27 | — |
| `apps/worker/src/services/booking-calendar-sync.ts` | F11 | — |
| `apps/worker/src/services/booking-confirm.ts` | F11 | — |
| `apps/worker/src/services/booking-expirer.ts` | F11 | — |
| `apps/worker/src/services/booking-idempotency.ts` | F11 | — |
| `apps/worker/src/services/booking-notifier.ts` | F11 | — |
| `apps/worker/src/services/booking-reminders.ts` | F11 | — |
| `apps/worker/src/services/booking-state.ts` | F11 | — |
| `apps/worker/src/services/booking-types.ts` | F11 | — |
| `apps/worker/src/services/broadcast-delivery-error.ts` | F04 | — |
| `apps/worker/src/services/broadcast-retry-key.ts` | F04 | — |
| `apps/worker/src/services/broadcast-sender.ts` | F04 | — |
| `apps/worker/src/services/broadcast.ts` | F04 | — |
| `apps/worker/src/services/camp-offer-delivery.ts` | F35 | — |
| `apps/worker/src/services/dedup-broadcast.ts` | F04 | — |
| `apps/worker/src/services/duplicate-detect.ts` | F01 | — |
| `apps/worker/src/services/duplicates-stats.ts` | F01 | — |
| `apps/worker/src/services/event-availability.ts` | F12 | — |
| `apps/worker/src/services/event-booking-expirer.ts` | F12 | — |
| `apps/worker/src/services/event-booking-idempotency.ts` | F12 | — |
| `apps/worker/src/services/event-booking-notifier.ts` | F12 | — |
| `apps/worker/src/services/event-booking-reminders.ts` | F12 | — |
| `apps/worker/src/services/event-booking-state.ts` | F12 | — |
| `apps/worker/src/services/event-booking-types.ts` | F12 | — |
| `apps/worker/src/services/event-bus.ts` | F18 | — |
| `apps/worker/src/services/follower-import.ts` | F01 | — |
| `apps/worker/src/services/friend-tag-attach.ts` | F02 | — |
| `apps/worker/src/services/google-calendar.ts` | F11 | — |
| `apps/worker/src/services/google-oauth.ts` | F11 | — |
| `apps/worker/src/services/google-service-account.ts` | F11 | — |
| `apps/worker/src/services/immediate-first-step.ts` | F03 | — |
| `apps/worker/src/services/incoming-image.ts` | F22 | — |
| `apps/worker/src/services/insight-fetcher.ts` | F24 | — |
| `apps/worker/src/services/intro-message.ts` | F03 | — |
| `apps/worker/src/services/keyword-match.ts` | F05 | — |
| `apps/worker/src/services/liff-auth.ts` | F08 | — |
| `apps/worker/src/services/line-proxy-send.ts` | F31 | — |
| `apps/worker/src/services/live-game-auth.ts` | F26 | — |
| `apps/worker/src/services/live-game-store.ts` | F26 | — |
| `apps/worker/src/services/live-game.ts` | F26 | — |
| `apps/worker/src/services/local-line-proxy.ts` | F31 | — |
| `apps/worker/src/services/log-retention.ts` | F30 | — |
| `apps/worker/src/services/meet-consultation-reminders.ts` | F13 | — |
| `apps/worker/src/services/message-group.ts` | F04 | — |
| `apps/worker/src/services/quota-alert.ts` | F30 | — |
| `apps/worker/src/services/quota.ts` | F30 | — |
| `apps/worker/src/services/reminder-delivery.ts` | F14 | — |
| `apps/worker/src/services/render-message.ts` | F06 | — |
| `apps/worker/src/services/reward-message.ts` | F35 | — |
| `apps/worker/src/services/reward-resolver.ts` | F35 | — |
| `apps/worker/src/services/sales-consultation-policy.ts` | F13 | — |
| `apps/worker/src/services/scenario-stats.ts` | F03 | — |
| `apps/worker/src/services/segment-query.ts` | F04 | — |
| `apps/worker/src/services/segment-send.ts` | F04 | — |
| `apps/worker/src/services/six-community.ts` | F26 | — |
| `apps/worker/src/services/six-game-auth.ts` | F26 | — |
| `apps/worker/src/services/six-game-store.ts` | F26 | — |
| `apps/worker/src/services/six-game.ts` | F26 | — |
| `apps/worker/src/services/six-leaderboard.ts` | F26 | — |
| `apps/worker/src/services/stealth.ts` | X01 | — |
| `apps/worker/src/services/step-delivery.ts` | F03 | — |
| `apps/worker/src/services/tag-automation-context.ts` | F02 | — |
| `apps/worker/src/services/token-refresh.ts` | F27 | — |
| `apps/worker/src/services/unanswered-inbox.ts` | F21 | — |
| `apps/worker/src/services/users-grouped.ts` | F01 | — |
| `apps/worker/src/services/webhook-signature.ts` | F19 | — |
| `apps/worker/src/services/webinar-consultation-booking.ts` | F13 | — |
| `apps/worker/src/services/webinar-followups.ts` | F15 | — |
| `apps/worker/src/services/webinar-mileage.ts` | F35 | — |
| `apps/worker/src/services/webinar-reminders.ts` | F15 | — |
| `apps/worker/src/services/webinar-schedule.ts` | F15 | — |
| `docs/community-mile-rewards/100-prompt-kit.md` | F35 | — |
| `docs/community-mile-rewards/300-work-brief.md` | F35 | — |
| `docs/community-mile-rewards/500-weekly-review.md` | F35 | — |
| `docs/community-mile-rewards/README.md` | F35 | — |
| `examples/plugins/tag-rules/README.md` | F36 | — |
| `examples/plugins/tag-rules/src/index.ts` | F36 | — |
| `examples/plugins/tag-rules/src/rules.ts` | F36 | — |
| `packages/mcp-server/src/tools/account-summary.ts` | F34 | — |
| `packages/mcp-server/src/tools/broadcast.ts` | F34 | — |
| `packages/mcp-server/src/tools/create-form.ts` | F34 | — |
| `packages/mcp-server/src/tools/create-rich-menu.ts` | F34 | — |
| `packages/mcp-server/src/tools/create-scenario.ts` | F34 | — |
| `packages/mcp-server/src/tools/create-tracked-link.ts` | F34 | — |
| `packages/mcp-server/src/tools/enroll-scenario.ts` | F34 | — |
| `packages/mcp-server/src/tools/get-conversation.ts` | F34 | — |
| `packages/mcp-server/src/tools/get-conversion-logs.ts` | F34 | — |
| `packages/mcp-server/src/tools/get-form-submissions.ts` | F34 | — |
| `packages/mcp-server/src/tools/get-friend-detail.ts` | F34 | — |
| `packages/mcp-server/src/tools/get-link-clicks.ts` | F34 | — |
| `packages/mcp-server/src/tools/index.ts` | F34 | — |
| `packages/mcp-server/src/tools/list-conversations.ts` | F34 | — |
| `packages/mcp-server/src/tools/list-crm-objects.ts` | F34 | — |
| `packages/mcp-server/src/tools/list-friends.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-ad-platforms.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-auto-replies.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-broadcasts.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-entry-routes.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-forms.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-friends.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-message-templates.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-rich-menus.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-scenarios.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-staff.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-tags.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-tracked-links.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-traffic-pools.ts` | F34 | — |
| `packages/mcp-server/src/tools/manage-webinar-video.ts` | F34 | — |
| `packages/mcp-server/src/tools/send-message.ts` | F34 | — |
| `packages/mcp-server/src/tools/test-banner.ts` | F34 | — |
| `packages/mcp-server/src/tools/upload-image.ts` | F34 | — |
| `packages/plugin-template/src/external-api.ts` | F36 | — |
| `packages/plugin-template/src/index.ts` | F36 | — |
| `packages/plugin-template/src/notify.ts` | F36 | — |
| `packages/plugin-template/src/sync.ts` | F36 | — |
| `packages/update-engine/src/admin-url-placeholder.ts` | F29 | — |
| `packages/update-engine/src/bundle.ts` | F29 | — |
| `packages/update-engine/src/cf-api/_shared.ts` | F29 | — |
| `packages/update-engine/src/cf-api/asset-hash.ts` | F29 | — |
| `packages/update-engine/src/cf-api/assets.ts` | F29 | — |
| `packages/update-engine/src/cf-api/d1.ts` | F29 | — |
| `packages/update-engine/src/cf-api/pages.ts` | F29 | — |
| `packages/update-engine/src/cf-api/subdomain.ts` | F29 | — |
| `packages/update-engine/src/cf-api/workers.ts` | F29 | — |
| `packages/update-engine/src/events.ts` | F29 | — |
| `packages/update-engine/src/fork-detect.ts` | F29 | — |
| `packages/update-engine/src/index.ts` | F29 | — |
| `packages/update-engine/src/legacy-mileage.ts` | F29 | — |
| `packages/update-engine/src/manifest.ts` | F29 | — |
| `packages/update-engine/src/materialize.ts` | F29 | — |
| `packages/update-engine/src/migrations.ts` | F29 | — |
| `packages/update-engine/src/phases/apply.ts` | F29 | — |
| `packages/update-engine/src/phases/preflight.ts` | F29 | — |
| `packages/update-engine/src/phases/rollback.ts` | F29 | — |
| `packages/update-engine/src/phases/verify.ts` | F29 | — |
| `packages/update-engine/src/pure.ts` | F29 | — |
| `packages/update-engine/src/snapshot.ts` | F29 | — |
| `packages/update-engine/src/sql-statements.ts` | F29 | — |
| `packages/update-engine/src/types.ts` | F29 | — |

## HTTP操作単位の照合

全入口は親の判定・優先度を継承。LINE固有の経路名をTelegramへそのまま移植する意味ではない。

| 元ファイル:行 | 操作 | 判定表ID |
|---|---|---|
| `apps/worker/src/index.ts:283` | `GET /api/qr` | F30 |
| `apps/worker/src/index.ts:303` | `GET /r/:ref` | F30 |
| `apps/worker/src/index.ts:555` | `GET /r/:ref/help` | F30 |
| `apps/worker/src/index.ts:708` | `GET /o` | F30 |
| `apps/worker/src/index.ts:808` | `GET /book` | F30 |
| `apps/worker/src/routes/account-settings.ts:13` | `GET /api/account-settings/test-recipients` | F27 |
| `apps/worker/src/routes/account-settings.ts:42` | `PUT /api/account-settings/test-recipients` | F27 |
| `apps/worker/src/routes/account-settings.ts:67` | `GET /api/account-settings/link-base-url` | F27 |
| `apps/worker/src/routes/account-settings.ts:79` | `PUT /api/account-settings/link-base-url` | F27 |
| `apps/worker/src/routes/account-settings.ts:98` | `GET /api/account-settings/tracked-link-base-url` | F27 |
| `apps/worker/src/routes/account-settings.ts:103` | `PUT /api/account-settings/tracked-link-base-url` | F27 |
| `apps/worker/src/routes/ad-platforms.ts:29` | `GET /api/ad-platforms` | F24 |
| `apps/worker/src/routes/ad-platforms.ts:51` | `POST /api/ad-platforms` | F24 |
| `apps/worker/src/routes/ad-platforms.ts:93` | `PUT /api/ad-platforms/:id` | F24 |
| `apps/worker/src/routes/ad-platforms.ts:127` | `POST /api/ad-platforms/test` | F24 |
| `apps/worker/src/routes/ad-platforms.ts:162` | `DELETE /api/ad-platforms/:id` | F24 |
| `apps/worker/src/routes/ad-platforms.ts:173` | `GET /api/ad-platforms/:id/logs` | F24 |
| `apps/worker/src/routes/admin-auth.ts:29` | `POST /api/auth/login` | F28 |
| `apps/worker/src/routes/admin-auth.ts:57` | `POST /api/auth/logout` | F28 |
| `apps/worker/src/routes/admin-auth.ts:70` | `GET /api/auth/session` | F28 |
| `apps/worker/src/routes/admin-sso.ts:121` | `GET /admin/sso` | F28 |
| `apps/worker/src/routes/admin-update.ts:131` | `POST /start` | F29 |
| `apps/worker/src/routes/admin-update.ts:235` | `GET /status/:id` | F29 |
| `apps/worker/src/routes/admin-update.ts:271` | `GET /stream/:id` | F29 |
| `apps/worker/src/routes/admin-update.ts:355` | `GET /history` | F29 |
| `apps/worker/src/routes/admin-version.ts:27` | `GET /version` | F29 |
| `apps/worker/src/routes/admin-version.ts:38` | `GET /manifest` | F29 |
| `apps/worker/src/routes/affiliate-offers.ts:42` | `GET /api/affiliate-offers` | F25 |
| `apps/worker/src/routes/affiliate-offers.ts:54` | `GET /api/affiliate-offers/:id` | F25 |
| `apps/worker/src/routes/affiliate-offers.ts:68` | `POST /api/affiliate-offers` | F25 |
| `apps/worker/src/routes/affiliate-offers.ts:116` | `PUT /api/affiliate-offers/:id` | F25 |
| `apps/worker/src/routes/affiliate-self.ts:167` | `GET /api/liff/mileage/me` | F25 |
| `apps/worker/src/routes/affiliate-self.ts:213` | `POST /api/liff/affiliate/register` | F25 |
| `apps/worker/src/routes/affiliate-self.ts:283` | `GET /api/liff/affiliate/me` | F25 |
| `apps/worker/src/routes/affiliate-self.ts:330` | `POST /api/liff/affiliate/links` | F25 |
| `apps/worker/src/routes/affiliate-self.ts:403` | `GET /api/liff/affiliate/offers` | F25 |
| `apps/worker/src/routes/affiliate-self.ts:462` | `POST /api/liff/affiliate/offers/:id/enroll` | F25 |
| `apps/worker/src/routes/affiliates.ts:40` | `GET /api/affiliates` | F25 |
| `apps/worker/src/routes/affiliates.ts:51` | `GET /api/affiliates/:id` | F25 |
| `apps/worker/src/routes/affiliates.ts:77` | `POST /api/affiliates` | F25 |
| `apps/worker/src/routes/affiliates.ts:198` | `PUT /api/affiliates/:id` | F25 |
| `apps/worker/src/routes/affiliates.ts:224` | `DELETE /api/affiliates/:id` | F25 |
| `apps/worker/src/routes/affiliates.ts:237` | `GET /api/affiliates/:id/report` | F25 |
| `apps/worker/src/routes/affiliates.ts:257` | `GET /api/affiliates/:id/journeys` | F25 |
| `apps/worker/src/routes/affiliates.ts:277` | `GET /api/affiliates/:id/links` | F25 |
| `apps/worker/src/routes/affiliates.ts:300` | `GET /api/friends/:id/journey` | F25 |
| `apps/worker/src/routes/affiliates.ts:311` | `POST /api/affiliates/click` | F25 |
| `apps/worker/src/routes/affiliates.ts:337` | `GET /api/affiliates-report` | F25 |
| `apps/worker/src/routes/auto-replies.ts:108` | `GET /api/auto-replies` | F05 |
| `apps/worker/src/routes/auto-replies.ts:136` | `GET /api/auto-replies/:id` | F05 |
| `apps/worker/src/routes/auto-replies.ts:151` | `POST /api/auto-replies` | F05 |
| `apps/worker/src/routes/auto-replies.ts:202` | `PUT /api/auto-replies/:id` | F05 |
| `apps/worker/src/routes/auto-replies.ts:249` | `DELETE /api/auto-replies/:id` | F05 |
| `apps/worker/src/routes/automations.ts:16` | `GET /api/automations` | F18 |
| `apps/worker/src/routes/automations.ts:56` | `GET /api/automations/:id` | F18 |
| `apps/worker/src/routes/automations.ts:94` | `POST /api/automations` | F18 |
| `apps/worker/src/routes/automations.ts:137` | `PUT /api/automations/:id` | F18 |
| `apps/worker/src/routes/automations.ts:163` | `DELETE /api/automations/:id` | F18 |
| `apps/worker/src/routes/automations.ts:175` | `GET /api/automations/:id/logs` | F18 |
| `apps/worker/src/routes/booking.ts:303` | `GET /api/liff/booking/menus` | F11 |
| `apps/worker/src/routes/booking.ts:326` | `GET /api/liff/booking/menus/:id/staff` | F11 |
| `apps/worker/src/routes/booking.ts:347` | `GET /api/liff/booking/availability` | F11 |
| `apps/worker/src/routes/booking.ts:376` | `POST /api/liff/booking/requests` | F11 |
| `apps/worker/src/routes/booking.ts:576` | `GET /api/liff/booking/me` | F11 |
| `apps/worker/src/routes/booking.ts:628` | `GET /api/booking/admin/menus` | F11 |
| `apps/worker/src/routes/booking.ts:645` | `POST /api/booking/admin/menus` | F11 |
| `apps/worker/src/routes/booking.ts:690` | `PUT /api/booking/admin/menus/:id` | F11 |
| `apps/worker/src/routes/booking.ts:770` | `DELETE /api/booking/admin/menus/:id` | F11 |
| `apps/worker/src/routes/booking.ts:789` | `GET /api/booking/admin/menus/:id/staff` | F11 |
| `apps/worker/src/routes/booking.ts:813` | `GET /api/booking/admin/availability` | F11 |
| `apps/worker/src/routes/booking.ts:845` | `POST /api/booking/admin/bookings` | F11 |
| `apps/worker/src/routes/booking.ts:990` | `GET /api/booking/admin/staff` | F11 |
| `apps/worker/src/routes/booking.ts:1012` | `POST /api/booking/admin/staff` | F11 |
| `apps/worker/src/routes/booking.ts:1047` | `PUT /api/booking/admin/staff/:id` | F11 |
| `apps/worker/src/routes/booking.ts:1085` | `DELETE /api/booking/admin/staff/:id` | F11 |
| `apps/worker/src/routes/booking.ts:1102` | `GET /api/booking/admin/staff/:id/menus` | F11 |
| `apps/worker/src/routes/booking.ts:1125` | `PUT /api/booking/admin/staff/:id/menus` | F11 |
| `apps/worker/src/routes/booking.ts:1174` | `GET /api/booking/admin/staff/:id/availability-rules` | F11 |
| `apps/worker/src/routes/booking.ts:1193` | `PUT /api/booking/admin/staff/:id/availability-rules` | F11 |
| `apps/worker/src/routes/booking.ts:1234` | `POST /api/booking/admin/staff/:id/google-calendar/oauth/start` | F11 |
| `apps/worker/src/routes/booking.ts:1264` | `GET <expression:GOOGLE_OAUTH_CALLBACK_PATH>` | F11 |
| `apps/worker/src/routes/booking.ts:1350` | `GET /api/booking/admin/staff/:id/google-calendar` | F11 |
| `apps/worker/src/routes/booking.ts:1380` | `PUT /api/booking/admin/staff/:id/google-calendar` | F11 |
| `apps/worker/src/routes/booking.ts:1440` | `DELETE /api/booking/admin/staff/:id/google-calendar` | F11 |
| `apps/worker/src/routes/booking.ts:1479` | `GET /api/booking/admin/staff/:id/shifts` | F11 |
| `apps/worker/src/routes/booking.ts:1502` | `PUT /api/booking/admin/staff/:id/shifts` | F11 |
| `apps/worker/src/routes/booking.ts:1529` | `DELETE /api/booking/admin/staff/:id/shifts/:shiftId` | F11 |
| `apps/worker/src/routes/booking.ts:1544` | `POST /api/booking/admin/staff/:id/shifts/generate` | F11 |
| `apps/worker/src/routes/booking.ts:1587` | `GET /api/booking/admin/requests` | F11 |
| `apps/worker/src/routes/booking.ts:1621` | `PATCH /api/booking/admin/requests/:id` | F11 |
| `apps/worker/src/routes/booking.ts:1693` | `GET /api/booking/admin/pending-count` | F11 |
| `apps/worker/src/routes/broadcasts.ts:147` | `GET /api/broadcasts` | F04 |
| `apps/worker/src/routes/broadcasts.ts:159` | `GET /api/broadcasts/:id` | F04 |
| `apps/worker/src/routes/broadcasts.ts:179` | `GET /api/broadcasts/:id/preview-count` | F04 |
| `apps/worker/src/routes/broadcasts.ts:246` | `GET /api/broadcasts/:id/per-account-stats` | F04 |
| `apps/worker/src/routes/broadcasts.ts:335` | `POST /api/broadcasts` | F04 |
| `apps/worker/src/routes/broadcasts.ts:433` | `PUT /api/broadcasts/:id` | F04 |
| `apps/worker/src/routes/broadcasts.ts:531` | `DELETE /api/broadcasts/:id` | F04 |
| `apps/worker/src/routes/broadcasts.ts:580` | `POST /api/broadcasts/:id/send` | F04 |
| `apps/worker/src/routes/broadcasts.ts:844` | `POST /api/broadcasts/:id/send-segment` | F04 |
| `apps/worker/src/routes/broadcasts.ts:940` | `GET /api/broadcasts/:id/insight` | F04 |
| `apps/worker/src/routes/broadcasts.ts:972` | `POST /api/broadcasts/:id/fetch-insight` | F04 |
| `apps/worker/src/routes/broadcasts.ts:1137` | `POST /api/broadcasts/:id/test-send` | F04 |
| `apps/worker/src/routes/broadcasts.ts:1226` | `GET /api/broadcasts/:id/progress` | F04 |
| `apps/worker/src/routes/broadcasts.ts:1244` | `POST /api/segments/count` | F04 |
| `apps/worker/src/routes/calendar.ts:22` | `GET /api/integrations/google-calendar` | F11 |
| `apps/worker/src/routes/calendar.ts:42` | `POST /api/integrations/google-calendar/connect` | F11 |
| `apps/worker/src/routes/calendar.ts:57` | `DELETE /api/integrations/google-calendar/:id` | F11 |
| `apps/worker/src/routes/calendar.ts:69` | `GET /api/integrations/google-calendar/slots` | F11 |
| `apps/worker/src/routes/calendar.ts:149` | `GET /api/integrations/google-calendar/bookings` | F11 |
| `apps/worker/src/routes/calendar.ts:175` | `POST /api/integrations/google-calendar/book` | F11 |
| `apps/worker/src/routes/calendar.ts:231` | `PUT /api/integrations/google-calendar/bookings/:id/status` | F11 |
| `apps/worker/src/routes/capabilities.ts:37` | `GET /api/capabilities` | F30 |
| `apps/worker/src/routes/chats.ts:136` | `GET /api/operators` | F21 |
| `apps/worker/src/routes/chats.ts:157` | `POST /api/operators` | F21 |
| `apps/worker/src/routes/chats.ts:169` | `PUT /api/operators/:id` | F21 |
| `apps/worker/src/routes/chats.ts:183` | `DELETE /api/operators/:id` | F21 |
| `apps/worker/src/routes/chats.ts:195` | `GET /api/chats` | F21 |
| `apps/worker/src/routes/chats.ts:403` | `GET /api/chats/:id` | F21 |
| `apps/worker/src/routes/chats.ts:481` | `POST /api/chats` | F21 |
| `apps/worker/src/routes/chats.ts:499` | `PUT /api/chats/:id` | F21 |
| `apps/worker/src/routes/chats.ts:520` | `POST /api/chats/:id/loading` | F21 |
| `apps/worker/src/routes/chats.ts:557` | `POST /api/chats/:id/send` | F21 |
| `apps/worker/src/routes/conversations.ts:7` | `GET /api/conversations` | F21 |
| `apps/worker/src/routes/conversations.ts:182` | `GET /api/conversations/:friendId` | F21 |
| `apps/worker/src/routes/conversions.ts:24` | `GET /api/conversions/points` | F23 |
| `apps/worker/src/routes/conversions.ts:44` | `POST /api/conversions/points` | F23 |
| `apps/worker/src/routes/conversions.ts:74` | `DELETE /api/conversions/points/:id` | F23 |
| `apps/worker/src/routes/conversions.ts:87` | `POST /api/conversions/track` | F23 |
| `apps/worker/src/routes/conversions.ts:131` | `GET /api/conversions/events` | F23 |
| `apps/worker/src/routes/conversions.ts:162` | `GET /api/conversions/report` | F23 |
| `apps/worker/src/routes/conversions.ts:183` | `GET /api/conversions/approvals` | F23 |
| `apps/worker/src/routes/conversions.ts:211` | `PATCH /api/conversions/events/:id/approval` | F23 |
| `apps/worker/src/routes/dedup-preview.ts:8` | `POST /api/broadcasts/dedup-preview` | F04 |
| `apps/worker/src/routes/duplicates.ts:70` | `GET /api/duplicates/stats` | F01 |
| `apps/worker/src/routes/entry-routes.ts:34` | `GET /api/entry-routes` | F10 |
| `apps/worker/src/routes/entry-routes.ts:45` | `GET /api/entry-routes/:id` | F10 |
| `apps/worker/src/routes/entry-routes.ts:62` | `POST /api/entry-routes` | F10 |
| `apps/worker/src/routes/entry-routes.ts:90` | `PATCH /api/entry-routes/:id` | F10 |
| `apps/worker/src/routes/entry-routes.ts:119` | `DELETE /api/entry-routes/:id` | F10 |
| `apps/worker/src/routes/entry-routes.ts:131` | `GET /api/entry-routes/:id/funnel` | F10 |
| `apps/worker/src/routes/events.ts:154` | `POST /api/events/admin/events` | F12 |
| `apps/worker/src/routes/events.ts:215` | `GET /api/events/admin/events` | F12 |
| `apps/worker/src/routes/events.ts:254` | `GET /api/events/admin/events/:id` | F12 |
| `apps/worker/src/routes/events.ts:272` | `PUT /api/events/admin/events/:id` | F12 |
| `apps/worker/src/routes/events.ts:429` | `DELETE /api/events/admin/events/:id` | F12 |
| `apps/worker/src/routes/events.ts:515` | `GET /api/events/admin/events/:id/slots` | F12 |
| `apps/worker/src/routes/events.ts:533` | `POST /api/events/admin/events/:id/slots` | F12 |
| `apps/worker/src/routes/events.ts:569` | `PUT /api/events/admin/events/:id/slots/:slotId` | F12 |
| `apps/worker/src/routes/events.ts:624` | `GET /api/liff/events/me` | F12 |
| `apps/worker/src/routes/events.ts:669` | `GET /api/liff/events/me/:bookingId` | F12 |
| `apps/worker/src/routes/events.ts:701` | `POST /api/liff/events/me/:bookingId/cancel` | F12 |
| `apps/worker/src/routes/events.ts:746` | `GET /api/liff/events/:id` | F12 |
| `apps/worker/src/routes/events.ts:803` | `GET /api/liff/events/:id/slots` | F12 |
| `apps/worker/src/routes/events.ts:855` | `POST /api/liff/events/:id/bookings` | F12 |
| `apps/worker/src/routes/events.ts:1152` | `DELETE /api/events/admin/events/:id/slots/:slotId` | F12 |
| `apps/worker/src/routes/events.ts:1180` | `GET /api/events/admin/events/notifications/pending` | F12 |
| `apps/worker/src/routes/events.ts:1194` | `GET /api/events/admin/events/:id/bookings` | F12 |
| `apps/worker/src/routes/events.ts:1307` | `POST /api/events/admin/events/:id/bookings/:bookingId/decide` | F12 |
| `apps/worker/src/routes/events.ts:1380` | `POST /api/events/admin/events/:id/bookings/:bookingId/cancel` | F12 |
| `apps/worker/src/routes/events.ts:1406` | `PUT /api/events/admin/events/:id/bookings/:bookingId` | F12 |
| `apps/worker/src/routes/forms.ts:182` | `GET /api/forms` | F08 |
| `apps/worker/src/routes/forms.ts:203` | `GET /api/forms/:id` | F08 |
| `apps/worker/src/routes/forms.ts:224` | `POST /api/forms` | F08 |
| `apps/worker/src/routes/forms.ts:273` | `PUT /api/forms/:id` | F08 |
| `apps/worker/src/routes/forms.ts:327` | `DELETE /api/forms/:id` | F08 |
| `apps/worker/src/routes/forms.ts:343` | `GET /api/forms/:id/submissions` | F08 |
| `apps/worker/src/routes/forms.ts:359` | `POST /api/forms/:id/opened` | F08 |
| `apps/worker/src/routes/forms.ts:389` | `POST /api/forms/:id/partial` | F08 |
| `apps/worker/src/routes/forms.ts:418` | `POST /api/forms/:id/submit` | F08 |
| `apps/worker/src/routes/friends.ts:87` | `GET /api/friends` | F01 |
| `apps/worker/src/routes/friends.ts:348` | `GET /api/friends/count` | F01 |
| `apps/worker/src/routes/friends.ts:367` | `GET /api/friends/ref-stats` | F01 |
| `apps/worker/src/routes/friends.ts:393` | `GET /api/friends/:id/mileage` | F01 |
| `apps/worker/src/routes/friends.ts:417` | `GET /api/friends/:id` | F01 |
| `apps/worker/src/routes/friends.ts:454` | `POST /api/friends/:id/tags` | F01 |
| `apps/worker/src/routes/friends.ts:491` | `DELETE /api/friends/:id/tags/:tagId` | F01 |
| `apps/worker/src/routes/friends.ts:509` | `PUT /api/friends/:id/metadata` | F01 |
| `apps/worker/src/routes/friends.ts:552` | `GET /api/friends/:id/messages` | F01 |
| `apps/worker/src/routes/friends.ts:577` | `POST /api/friends/:id/messages` | F01 |
| `apps/worker/src/routes/health.ts:22` | `GET /health` | F30 |
| `apps/worker/src/routes/health.ts:23` | `GET /api/health` | F30 |
| `apps/worker/src/routes/health.ts:27` | `GET /api/accounts/:id/health` | F30 |
| `apps/worker/src/routes/health.ts:57` | `GET /api/accounts/migrations` | F30 |
| `apps/worker/src/routes/health.ts:79` | `POST /api/accounts/:id/migrate` | F30 |
| `apps/worker/src/routes/health.ts:122` | `GET /api/accounts/migrations/:migrationId` | F30 |
| `apps/worker/src/routes/images.ts:7` | `POST /api/images` | F22 |
| `apps/worker/src/routes/images.ts:76` | `GET /images/:key` | F22 |
| `apps/worker/src/routes/images.ts:98` | `DELETE /api/images/:key` | F22 |
| `apps/worker/src/routes/inbox.ts:18` | `GET /api/inbox/activity-digest` | F21 |
| `apps/worker/src/routes/inbox.ts:36` | `GET /api/inbox/unanswered` | F21 |
| `apps/worker/src/routes/inbox.ts:60` | `GET /api/inbox/unanswered/count` | F21 |
| `apps/worker/src/routes/instagram-engagement.ts:13` | `POST /api/integrations/ig-harness/engagement` | F32 |
| `apps/worker/src/routes/liff.ts:317` | `GET /auth/line` | F08 |
| `apps/worker/src/routes/liff.ts:572` | `GET /auth/oauth` | F08 |
| `apps/worker/src/routes/liff.ts:652` | `GET /auth/callback` | F08 |
| `apps/worker/src/routes/liff.ts:1107` | `GET /api/liff/config` | F08 |
| `apps/worker/src/routes/liff.ts:1151` | `POST /api/liff/profile` | F08 |
| `apps/worker/src/routes/liff.ts:1179` | `POST /api/liff/link` | F08 |
| `apps/worker/src/routes/liff.ts:1405` | `GET /api/analytics/ref-summary` | F08 |
| `apps/worker/src/routes/liff.ts:1478` | `GET /api/analytics/ref/:refCode` | F08 |
| `apps/worker/src/routes/liff.ts:1536` | `POST /api/links/wrap` | F08 |
| `apps/worker/src/routes/liff.ts:1787` | `POST /api/liff/send-form-link` | F08 |
| `apps/worker/src/routes/line-accounts.ts:99` | `GET /api/line-accounts` | F27 |
| `apps/worker/src/routes/line-accounts.ts:193` | `GET /api/line-accounts/delivery-health` | F27 |
| `apps/worker/src/routes/line-accounts.ts:303` | `GET /api/line-accounts/:id` | F27 |
| `apps/worker/src/routes/line-accounts.ts:321` | `GET /api/line-accounts/:id/follower-insight` | F27 |
| `apps/worker/src/routes/line-accounts.ts:356` | `GET /api/line-accounts/:id/follower-import` | F27 |
| `apps/worker/src/routes/line-accounts.ts:363` | `POST /api/line-accounts/:id/follower-import/detect` | F27 |
| `apps/worker/src/routes/line-accounts.ts:385` | `POST /api/line-accounts/:id/follower-import/start` | F27 |
| `apps/worker/src/routes/line-accounts.ts:403` | `POST /api/line-accounts/:id/follower-import/step` | F27 |
| `apps/worker/src/routes/line-accounts.ts:512` | `POST /api/line-accounts` | F27 |
| `apps/worker/src/routes/line-accounts.ts:626` | `PATCH /api/line-accounts/order` | F27 |
| `apps/worker/src/routes/line-accounts.ts:666` | `PATCH /api/line-accounts/:id` | F27 |
| `apps/worker/src/routes/line-accounts.ts:786` | `PUT /api/line-accounts/:id` | F27 |
| `apps/worker/src/routes/line-accounts.ts:894` | `DELETE /api/line-accounts/:id` | F27 |
| `apps/worker/src/routes/line-proxy.ts:901` | `ALL /line-api/*` | F31 |
| `apps/worker/src/routes/line-proxy.ts:902` | `ALL /line-api-data/*` | F31 |
| `apps/worker/src/routes/live-games.ts:52` | `POST /api/live-games` | F26 |
| `apps/worker/src/routes/live-games.ts:63` | `GET /api/live-games/:id` | F26 |
| `apps/worker/src/routes/live-games.ts:70` | `POST /api/live-games/:id/action` | F26 |
| `apps/worker/src/routes/live-games.ts:85` | `POST /api/live-games/:id/screen-ticket` | F26 |
| `apps/worker/src/routes/live-games.ts:91` | `POST /api/liff/live-games/:id/join` | F26 |
| `apps/worker/src/routes/live-games.ts:115` | `GET /api/liff/live-games/:id/screen` | F26 |
| `apps/worker/src/routes/live-games.ts:122` | `GET /api/liff/live-games/:id/me` | F26 |
| `apps/worker/src/routes/live-games.ts:129` | `POST /api/liff/live-games/:id/action` | F26 |
| `apps/worker/src/routes/live-games.ts:142` | `GET /api/liff/live-games/:id/socket` | F26 |
| `apps/worker/src/routes/live-games.ts:158` | `GET /api/live-games/:id/participants` | F26 |
| `apps/worker/src/routes/live-games.ts:172` | `GET /api/live-games/:id/records` | F26 |
| `apps/worker/src/routes/media-inquiries.ts:46` | `POST /api/public/media-inquiries` | F33 |
| `apps/worker/src/routes/meet-callback.ts:11` | `POST /api/meet-callback` | F13 |
| `apps/worker/src/routes/meet-consultations.ts:11` | `GET /api/meet-consultations` | F13 |
| `apps/worker/src/routes/meet-consultations.ts:36` | `POST /api/meet-consultations` | F13 |
| `apps/worker/src/routes/meet-consultations.ts:48` | `DELETE /api/meet-consultations/:externalEventId` | F13 |
| `apps/worker/src/routes/message-templates.ts:26` | `GET /api/message-templates` | F06 |
| `apps/worker/src/routes/message-templates.ts:37` | `GET /api/message-templates/:id` | F06 |
| `apps/worker/src/routes/message-templates.ts:49` | `POST /api/message-templates` | F06 |
| `apps/worker/src/routes/message-templates.ts:87` | `PUT /api/message-templates/:id` | F06 |
| `apps/worker/src/routes/message-templates.ts:127` | `DELETE /api/message-templates/:id` | F06 |
| `apps/worker/src/routes/notifications.ts:16` | `GET /api/notifications/rules` | F20 |
| `apps/worker/src/routes/notifications.ts:48` | `GET /api/notifications/rules/:id` | F20 |
| `apps/worker/src/routes/notifications.ts:70` | `POST /api/notifications/rules` | F20 |
| `apps/worker/src/routes/notifications.ts:85` | `PUT /api/notifications/rules/:id` | F20 |
| `apps/worker/src/routes/notifications.ts:102` | `DELETE /api/notifications/rules/:id` | F20 |
| `apps/worker/src/routes/notifications.ts:114` | `GET /api/notifications` | F20 |
| `apps/worker/src/routes/openapi.ts:1183` | `GET /openapi.json` | F30 |
| `apps/worker/src/routes/openapi.ts:1188` | `GET /docs` | F30 |
| `apps/worker/src/routes/profile-refresh.ts:19` | `POST /api/admin/refresh-profiles` | F01 |
| `apps/worker/src/routes/profile-refresh.ts:131` | `POST /api/admin/broadcasts/:id/reset-to-draft` | F01 |
| `apps/worker/src/routes/profile-refresh.ts:197` | `POST /api/admin/tag-leak-check` | F01 |
| `apps/worker/src/routes/profile-refresh.ts:250` | `POST /api/admin/content-leak-check` | F01 |
| `apps/worker/src/routes/profile-refresh.ts:300` | `POST /api/admin/broadcast-coverage` | F01 |
| `apps/worker/src/routes/profile-refresh.ts:409` | `POST /api/admin/tag-remove-content-dups` | F01 |
| `apps/worker/src/routes/profile-refresh.ts:456` | `GET /api/admin/auto-reply-stats` | F01 |
| `apps/worker/src/routes/profile-refresh.ts:529` | `GET /api/admin/recent-messages` | F01 |
| `apps/worker/src/routes/profile-refresh.ts:577` | `GET /api/admin/automations-summary` | F01 |
| `apps/worker/src/routes/profile-refresh.ts:605` | `GET /api/admin/friend-debug/:id` | F01 |
| `apps/worker/src/routes/reminders.ts:22` | `GET /api/reminders` | F14 |
| `apps/worker/src/routes/reminders.ts:52` | `GET /api/reminders/:id` | F14 |
| `apps/worker/src/routes/reminders.ts:85` | `POST /api/reminders` | F14 |
| `apps/worker/src/routes/reminders.ts:102` | `PUT /api/reminders/:id` | F14 |
| `apps/worker/src/routes/reminders.ts:116` | `DELETE /api/reminders/:id` | F14 |
| `apps/worker/src/routes/reminders.ts:128` | `POST /api/reminders/:id/steps` | F14 |
| `apps/worker/src/routes/reminders.ts:148` | `DELETE /api/reminders/:reminderId/steps/:stepId` | F14 |
| `apps/worker/src/routes/reminders.ts:160` | `POST /api/reminders/:id/enroll/:friendId` | F14 |
| `apps/worker/src/routes/reminders.ts:177` | `GET /api/friends/:friendId/reminders` | F14 |
| `apps/worker/src/routes/reminders.ts:198` | `DELETE /api/friend-reminders/:id` | F14 |
| `apps/worker/src/routes/rich-menu-groups.ts:253` | `GET /api/rich-menu-groups/external/:richMenuId/image` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:281` | `POST /api/rich-menu-groups/import` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:463` | `GET /api/rich-menu-groups/external` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:553` | `DELETE /api/rich-menu-groups/external/:richMenuId` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:593` | `GET /api/rich-menu-groups` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:637` | `GET /api/rich-menu-groups/:groupId` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:644` | `POST /api/rich-menu-groups` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:659` | `PATCH /api/rich-menu-groups/:groupId` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:682` | `DELETE /api/rich-menu-groups/:groupId` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:706` | `POST /api/rich-menu-groups/:groupId/pages/:pageId/image` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:747` | `GET /api/rich-menu-images/:key{.+}` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:854` | `POST /api/rich-menu-groups/:groupId/publish` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:913` | `POST /api/rich-menu-groups/:groupId/unpublish` | F07 |
| `apps/worker/src/routes/rich-menu-groups.ts:961` | `POST /api/rich-menu-groups/:groupId/apply-to-tag` | F07 |
| `apps/worker/src/routes/rich-menus.ts:19` | `GET /api/rich-menus` | F07 |
| `apps/worker/src/routes/rich-menus.ts:32` | `POST /api/rich-menus` | F07 |
| `apps/worker/src/routes/rich-menus.ts:46` | `DELETE /api/rich-menus/:id` | F07 |
| `apps/worker/src/routes/rich-menus.ts:60` | `POST /api/rich-menus/:id/default` | F07 |
| `apps/worker/src/routes/rich-menus.ts:74` | `POST /api/friends/:friendId/rich-menu` | F07 |
| `apps/worker/src/routes/rich-menus.ts:107` | `DELETE /api/friends/:friendId/rich-menu` | F07 |
| `apps/worker/src/routes/rich-menus.ts:135` | `GET /api/friends/:friendId/rich-menu` | F07 |
| `apps/worker/src/routes/rich-menus.ts:204` | `POST /api/rich-menus/:id/image` | F07 |
| `apps/worker/src/routes/scenarios.ts:178` | `GET /api/scenarios` | F03 |
| `apps/worker/src/routes/scenarios.ts:214` | `GET /api/scenarios/:id` | F03 |
| `apps/worker/src/routes/scenarios.ts:237` | `POST /api/scenarios` | F03 |
| `apps/worker/src/routes/scenarios.ts:286` | `PUT /api/scenarios/:id` | F03 |
| `apps/worker/src/routes/scenarios.ts:322` | `DELETE /api/scenarios/:id` | F03 |
| `apps/worker/src/routes/scenarios.ts:334` | `POST /api/scenarios/:id/steps` | F03 |
| `apps/worker/src/routes/scenarios.ts:418` | `PUT /api/scenarios/:id/steps/:stepId` | F03 |
| `apps/worker/src/routes/scenarios.ts:590` | `DELETE /api/scenarios/:id/steps/:stepId` | F03 |
| `apps/worker/src/routes/scenarios.ts:602` | `POST /api/scenarios/:id/steps/reorder` | F03 |
| `apps/worker/src/routes/scenarios.ts:679` | `GET /api/scenarios/:id/preview` | F03 |
| `apps/worker/src/routes/scenarios.ts:770` | `GET /api/scenarios/:id/stats` | F03 |
| `apps/worker/src/routes/scenarios.ts:797` | `GET /api/scenarios/:id/enrollments` | F03 |
| `apps/worker/src/routes/scenarios.ts:888` | `POST /api/scenarios/:id/enroll/:friendId` | F03 |
| `apps/worker/src/routes/scoring.ts:45` | `GET /api/mileage/overview` | F17 |
| `apps/worker/src/routes/scoring.ts:62` | `GET /api/mileage/rules` | F17 |
| `apps/worker/src/routes/scoring.ts:74` | `POST /api/mileage/events` | F17 |
| `apps/worker/src/routes/scoring.ts:120` | `POST /api/mileage/rules` | F17 |
| `apps/worker/src/routes/scoring.ts:156` | `PUT /api/mileage/rules/:id` | F17 |
| `apps/worker/src/routes/scoring.ts:187` | `DELETE /api/mileage/rules/:id` | F17 |
| `apps/worker/src/routes/scoring.ts:201` | `GET /api/scoring-rules` | F17 |
| `apps/worker/src/routes/scoring.ts:222` | `GET /api/scoring-rules/:id` | F17 |
| `apps/worker/src/routes/scoring.ts:236` | `POST /api/scoring-rules` | F17 |
| `apps/worker/src/routes/scoring.ts:250` | `PUT /api/scoring-rules/:id` | F17 |
| `apps/worker/src/routes/scoring.ts:264` | `DELETE /api/scoring-rules/:id` | F17 |
| `apps/worker/src/routes/scoring.ts:276` | `GET /api/friends/:id/score` | F17 |
| `apps/worker/src/routes/scoring.ts:304` | `POST /api/friends/:id/score` | F17 |
| `apps/worker/src/routes/setup.ts:6` | `GET /setup` | F30 |
| `apps/worker/src/routes/six-games.ts:32` | `POST /api/six-games` | F26 |
| `apps/worker/src/routes/six-games.ts:39` | `GET /api/six-games` | F26 |
| `apps/worker/src/routes/six-games.ts:40` | `GET /api/six-games/:id` | F26 |
| `apps/worker/src/routes/six-games.ts:41` | `POST /api/six-games/:id/action` | F26 |
| `apps/worker/src/routes/six-games.ts:46` | `POST /api/six-games/:id/ticket` | F26 |
| `apps/worker/src/routes/six-games.ts:47` | `POST /api/liff/six-games/:id/join` | F26 |
| `apps/worker/src/routes/six-games.ts:64` | `GET /api/liff/six-games/:id/me` | F26 |
| `apps/worker/src/routes/six-games.ts:65` | `POST /api/liff/six-games/:id/action` | F26 |
| `apps/worker/src/routes/six-games.ts:69` | `GET /api/liff/six-games/:id/screen` | F26 |
| `apps/worker/src/routes/six-games.ts:70` | `GET /api/liff/six-games/:id/leaderboard` | F26 |
| `apps/worker/src/routes/six-games.ts:71` | `GET /api/liff/six-games/:id/socket` | F26 |
| `apps/worker/src/routes/six-games.ts:76` | `GET /api/six-games/:id/players` | F26 |
| `apps/worker/src/routes/six-games.ts:77` | `GET /api/six-games/:id/records` | F26 |
| `apps/worker/src/routes/staff.ts:35` | `GET /api/staff/me` | F28 |
| `apps/worker/src/routes/staff.ts:73` | `GET /api/staff` | F28 |
| `apps/worker/src/routes/staff.ts:84` | `GET /api/staff/:id` | F28 |
| `apps/worker/src/routes/staff.ts:99` | `POST /api/staff` | F28 |
| `apps/worker/src/routes/staff.ts:127` | `PATCH /api/staff/:id` | F28 |
| `apps/worker/src/routes/staff.ts:178` | `DELETE /api/staff/:id` | F28 |
| `apps/worker/src/routes/staff.ts:208` | `POST /api/staff/:id/regenerate-key` | F28 |
| `apps/worker/src/routes/stripe.ts:31` | `GET /api/integrations/stripe/events` | F16 |
| `apps/worker/src/routes/stripe.ts:58` | `POST /api/integrations/stripe/webhook` | F16 |
| `apps/worker/src/routes/tags.ts:34` | `GET /api/tags` | F02 |
| `apps/worker/src/routes/tags.ts:48` | `PATCH /api/tags/:id/mileage` | F02 |
| `apps/worker/src/routes/tags.ts:95` | `POST /api/tags` | F02 |
| `apps/worker/src/routes/tags.ts:123` | `DELETE /api/tags/:id` | F02 |
| `apps/worker/src/routes/templates.ts:14` | `GET /api/templates` | F06 |
| `apps/worker/src/routes/templates.ts:37` | `GET /api/templates/:id` | F06 |
| `apps/worker/src/routes/templates.ts:63` | `GET /api/templates/:id/usages` | F06 |
| `apps/worker/src/routes/templates.ts:121` | `POST /api/templates` | F06 |
| `apps/worker/src/routes/templates.ts:135` | `PUT /api/templates/:id` | F06 |
| `apps/worker/src/routes/templates.ts:152` | `DELETE /api/templates/:id` | F06 |
| `apps/worker/src/routes/tracked-links.ts:94` | `GET /api/tracked-links` | F09 |
| `apps/worker/src/routes/tracked-links.ts:106` | `GET /api/tracked-links/:id` | F09 |
| `apps/worker/src/routes/tracked-links.ts:134` | `POST /api/tracked-links` | F09 |
| `apps/worker/src/routes/tracked-links.ts:178` | `PATCH /api/tracked-links/:id` | F09 |
| `apps/worker/src/routes/tracked-links.ts:207` | `DELETE /api/tracked-links/:id` | F09 |
| `apps/worker/src/routes/tracked-links.ts:312` | `GET /t/:linkId` | F09 |
| `apps/worker/src/routes/traffic-pools.ts:35` | `GET /pool/:slug` | F10 |
| `apps/worker/src/routes/traffic-pools.ts:57` | `GET /api/traffic-pools` | F10 |
| `apps/worker/src/routes/traffic-pools.ts:68` | `POST /api/traffic-pools` | F10 |
| `apps/worker/src/routes/traffic-pools.ts:93` | `PUT /api/traffic-pools/:id` | F10 |
| `apps/worker/src/routes/traffic-pools.ts:119` | `DELETE /api/traffic-pools/:id` | F10 |
| `apps/worker/src/routes/traffic-pools.ts:153` | `GET /api/traffic-pools/:id/accounts` | F10 |
| `apps/worker/src/routes/traffic-pools.ts:164` | `POST /api/traffic-pools/:id/accounts` | F10 |
| `apps/worker/src/routes/traffic-pools.ts:182` | `PUT /api/traffic-pools/:id/accounts/:accountId` | F10 |
| `apps/worker/src/routes/traffic-pools.ts:195` | `DELETE /api/traffic-pools/:id/accounts/:accountId` | F10 |
| `apps/worker/src/routes/usage.ts:9` | `GET /api/usage` | F30 |
| `apps/worker/src/routes/users-grouped.ts:8` | `GET /api/users-grouped` | F01 |
| `apps/worker/src/routes/users.ts:38` | `GET /api/users` | F01 |
| `apps/worker/src/routes/users.ts:49` | `GET /api/users/:id` | F01 |
| `apps/worker/src/routes/users.ts:64` | `POST /api/users` | F01 |
| `apps/worker/src/routes/users.ts:82` | `PUT /api/users/:id` | F01 |
| `apps/worker/src/routes/users.ts:110` | `DELETE /api/users/:id` | F01 |
| `apps/worker/src/routes/users.ts:121` | `POST /api/users/:id/link` | F01 |
| `apps/worker/src/routes/users.ts:139` | `GET /api/users/:id/accounts` | F01 |
| `apps/worker/src/routes/users.ts:159` | `POST /api/users/match` | F01 |
| `apps/worker/src/routes/webhook.ts:77` | `POST /webhook` | F19 |
| `apps/worker/src/routes/webhooks.ts:70` | `GET /api/webhooks/incoming` | F19 |
| `apps/worker/src/routes/webhooks.ts:91` | `POST /api/webhooks/incoming` | F19 |
| `apps/worker/src/routes/webhooks.ts:128` | `PUT /api/webhooks/incoming/:id` | F19 |
| `apps/worker/src/routes/webhooks.ts:177` | `DELETE /api/webhooks/incoming/:id` | F19 |
| `apps/worker/src/routes/webhooks.ts:189` | `GET /api/webhooks/outgoing` | F19 |
| `apps/worker/src/routes/webhooks.ts:211` | `POST /api/webhooks/outgoing` | F19 |
| `apps/worker/src/routes/webhooks.ts:258` | `PUT /api/webhooks/outgoing/:id` | F19 |
| `apps/worker/src/routes/webhooks.ts:329` | `DELETE /api/webhooks/outgoing/:id` | F19 |
| `apps/worker/src/routes/webhooks.ts:341` | `POST /api/webhooks/incoming/:id/receive` | F19 |
| `apps/worker/src/routes/webinars.ts:129` | `GET /api/liff/webinars/:slug` | F15 |
| `apps/worker/src/routes/webinars.ts:328` | `POST /api/liff/webinars/:slug/heartbeat` | F15 |
| `apps/worker/src/routes/webinars.ts:362` | `POST /api/liff/webinars/:slug/comments` | F15 |
| `apps/worker/src/routes/webinars.ts:423` | `POST /api/liff/webinars/:slug/register` | F15 |
| `apps/worker/src/routes/webinars.ts:475` | `POST /api/liff/webinars/:slug/cta-click` | F15 |
| `apps/worker/src/routes/webinars.ts:525` | `POST /api/liff/webinars/:slug/funnel-event` | F15 |
| `apps/worker/src/routes/webinars.ts:579` | `GET /api/liff/webinars/:slug/consultation-slots` | F15 |
| `apps/worker/src/routes/webinars.ts:608` | `POST /api/liff/webinars/:slug/consultation-book` | F15 |
| `apps/worker/src/routes/webinars.ts:655` | `GET /webinar-assets/:token/:slug/*` | F15 |
| `apps/worker/src/routes/webinars.ts:813` | `GET /api/webinars` | F15 |
| `apps/worker/src/routes/webinars.ts:827` | `POST /api/webinars` | F15 |
| `apps/worker/src/routes/webinars.ts:844` | `GET /api/webinars/:id` | F15 |
| `apps/worker/src/routes/webinars.ts:855` | `PUT /api/webinars/:id` | F15 |
| `apps/worker/src/routes/webinars.ts:879` | `DELETE /api/webinars/:id` | F15 |
| `apps/worker/src/routes/webinars.ts:892` | `GET /api/webinars/:id/comments` | F15 |
| `apps/worker/src/routes/webinars.ts:910` | `PUT /api/webinars/:id/comments` | F15 |
| `apps/worker/src/routes/webinars.ts:942` | `GET /api/webinars/:id/ctas` | F15 |
| `apps/worker/src/routes/webinars.ts:970` | `PUT /api/webinars/:id/ctas` | F15 |
| `apps/worker/src/routes/webinars.ts:1034` | `GET /api/webinars/:id/analytics` | F15 |
| `apps/worker/src/routes/webinars.ts:1111` | `GET /api/webinars/:id/user-comments` | F15 |
| `apps/worker/src/routes/webinars.ts:1148` | `PUT /api/webinars/:id/assets/:revision/*` | F15 |
| `apps/worker/src/routes/webinars.ts:1260` | `POST /api/webinars/:id/video` | F15 |
