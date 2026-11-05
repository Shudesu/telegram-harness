/** Operational templates, not a determination of licensing or legal compliance. */
export const industryTemplates = {
    beauty: { label: '美容室・美容サロン', night: false, fields: ['preferredStaff', 'service', 'allergyNote', 'preferences', 'nextVisit'] },
    restaurant: { label: '飲食店', night: false, fields: ['preferredStaff', 'allergyNote', 'seatPreference', 'course', 'partySize'] },
    wellness: { label: '整体・リラクゼーション', night: false, fields: ['preferredStaff', 'service', 'careNote', 'contraindications', 'nextVisit'] },
    cabaret: { label: 'キャバクラ', night: true, fields: ['preferredStaff', 'nomination', 'seatPreference', 'course', 'bottle', 'preferences'] },
    host: { label: 'ホストクラブ', night: true, fields: ['preferredStaff', 'nomination', 'course', 'bottle', 'preferences'] },
    bar: { label: 'バー', night: true, fields: ['preferredStaff', 'seatPreference', 'bottle', 'bottleExpiresAt', 'preferences'] },
} as const;
export type Industry = keyof typeof industryTemplates;
