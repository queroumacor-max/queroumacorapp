// @ts-check
/**
 * Type aliases para autocomplete em JS via JSDoc.
 *
 * Uso em outros arquivos:
 *   /** @typedef {import('./types').Profile} Profile *\/
 *   /** @type {Profile} *\/
 *   const me = await sb.from('profiles').select('*').single();
 *
 * Este arquivo NÃO tem runtime — só JSDoc typedefs. Pode ser carregado
 * num <script> que o tsserver ignora porque não tem nenhum código.
 */

// ============================================================
// products
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['products']['Row']} Product */
/** @typedef {import('./db.types').Database['public']['Tables']['products']['Insert']} ProductInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['products']['Update']} ProductUpdate */

// ============================================================
// profiles
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['profiles']['Row']} Profile */
/** @typedef {import('./db.types').Database['public']['Tables']['profiles']['Insert']} ProfileInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['profiles']['Update']} ProfileUpdate */

// ============================================================
// posts
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['posts']['Row']} Post */
/** @typedef {import('./db.types').Database['public']['Tables']['posts']['Insert']} PostInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['posts']['Update']} PostUpdate */

// ============================================================
// follows
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['follows']['Row']} Follow */
/** @typedef {import('./db.types').Database['public']['Tables']['follows']['Insert']} FollowInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['follows']['Update']} FollowUpdate */

// ============================================================
// likes
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['likes']['Row']} Like */
/** @typedef {import('./db.types').Database['public']['Tables']['likes']['Insert']} LikeInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['likes']['Update']} LikeUpdate */

// ============================================================
// comments
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['comments']['Row']} Comment */
/** @typedef {import('./db.types').Database['public']['Tables']['comments']['Insert']} CommentInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['comments']['Update']} CommentUpdate */

// ============================================================
// saved_posts
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['saved_posts']['Row']} SavedPost */
/** @typedef {import('./db.types').Database['public']['Tables']['saved_posts']['Insert']} SavedPostInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['saved_posts']['Update']} SavedPostUpdate */

// ============================================================
// announcements
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['announcements']['Row']} Announcement */
/** @typedef {import('./db.types').Database['public']['Tables']['announcements']['Insert']} AnnouncementInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['announcements']['Update']} AnnouncementUpdate */

// ============================================================
// orders
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['orders']['Row']} Order */
/** @typedef {import('./db.types').Database['public']['Tables']['orders']['Insert']} OrderInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['orders']['Update']} OrderUpdate */

// ============================================================
// messages
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['messages']['Row']} Message */
/** @typedef {import('./db.types').Database['public']['Tables']['messages']['Insert']} MessageInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['messages']['Update']} MessageUpdate */

// ============================================================
// reviews
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['reviews']['Row']} Review */
/** @typedef {import('./db.types').Database['public']['Tables']['reviews']['Insert']} ReviewInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['reviews']['Update']} ReviewUpdate */

// ============================================================
// quotes
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['quotes']['Row']} Quote */
/** @typedef {import('./db.types').Database['public']['Tables']['quotes']['Insert']} QuoteInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['quotes']['Update']} QuoteUpdate */

// ============================================================
// checklists
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['checklists']['Row']} Checklist */
/** @typedef {import('./db.types').Database['public']['Tables']['checklists']['Insert']} ChecklistInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['checklists']['Update']} ChecklistUpdate */

// ============================================================
// jobs
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['jobs']['Row']} Job */
/** @typedef {import('./db.types').Database['public']['Tables']['jobs']['Insert']} JobInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['jobs']['Update']} JobUpdate */

// ============================================================
// commissions
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['commissions']['Row']} Commission */
/** @typedef {import('./db.types').Database['public']['Tables']['commissions']['Insert']} CommissionInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['commissions']['Update']} CommissionUpdate */

// ============================================================
// points
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['points']['Row']} Point */
/** @typedef {import('./db.types').Database['public']['Tables']['points']['Insert']} PointInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['points']['Update']} PointUpdate */

// ============================================================
// referrals
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['referrals']['Row']} Referral */
/** @typedef {import('./db.types').Database['public']['Tables']['referrals']['Insert']} ReferralInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['referrals']['Update']} ReferralUpdate */

// ============================================================
// auto_responses
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['auto_responses']['Row']} AutoResponse */
/** @typedef {import('./db.types').Database['public']['Tables']['auto_responses']['Insert']} AutoResponseInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['auto_responses']['Update']} AutoResponseUpdate */

// ============================================================
// follow_ups
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['follow_ups']['Row']} FollowUp */
/** @typedef {import('./db.types').Database['public']['Tables']['follow_ups']['Insert']} FollowUpInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['follow_ups']['Update']} FollowUpUpdate */

// ============================================================
// qualifications
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['qualifications']['Row']} Qualification */
/** @typedef {import('./db.types').Database['public']['Tables']['qualifications']['Insert']} QualificationInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['qualifications']['Update']} QualificationUpdate */

// ============================================================
// courses
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['courses']['Row']} Course */
/** @typedef {import('./db.types').Database['public']['Tables']['courses']['Insert']} CourseInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['courses']['Update']} CourseUpdate */

// ============================================================
// notes
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['notes']['Row']} Note */
/** @typedef {import('./db.types').Database['public']['Tables']['notes']['Insert']} NoteInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['notes']['Update']} NoteUpdate */

// ============================================================
// notifications
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['notifications']['Row']} Notification */
/** @typedef {import('./db.types').Database['public']['Tables']['notifications']['Insert']} NotificationInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['notifications']['Update']} NotificationUpdate */

// ============================================================
// rate_limits
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['rate_limits']['Row']} RateLimit */
/** @typedef {import('./db.types').Database['public']['Tables']['rate_limits']['Insert']} RateLimitInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['rate_limits']['Update']} RateLimitUpdate */

// ============================================================
// audit_events
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['audit_events']['Row']} AuditEvent */
/** @typedef {import('./db.types').Database['public']['Tables']['audit_events']['Insert']} AuditEventInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['audit_events']['Update']} AuditEventUpdate */

// ============================================================
// account_deletion_requests
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['account_deletion_requests']['Row']} AccountDeletionRequest */
/** @typedef {import('./db.types').Database['public']['Tables']['account_deletion_requests']['Insert']} AccountDeletionRequestInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['account_deletion_requests']['Update']} AccountDeletionRequestUpdate */

// ============================================================
// reports
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['reports']['Row']} Report */
/** @typedef {import('./db.types').Database['public']['Tables']['reports']['Insert']} ReportInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['reports']['Update']} ReportUpdate */

// ============================================================
// feature_interest
// ============================================================
/** @typedef {import('./db.types').Database['public']['Tables']['feature_interest']['Row']} FeatureInterest */
/** @typedef {import('./db.types').Database['public']['Tables']['feature_interest']['Insert']} FeatureInterestInsert */
/** @typedef {import('./db.types').Database['public']['Tables']['feature_interest']['Update']} FeatureInterestUpdate */

// Re-export para keep file as a real module (não-empty)
export {};
