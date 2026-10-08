import { z } from 'zod';

export const HELP_AREAS = ['psikolojik', 'hukuk', 'topluluk', 'barinma', 'gonullu'];
export const ROLES = ['user', 'moderator', 'admin'];
export const REPORT_REASONS = [
  'spam',
  'taciz',
  'nefret',
  'cinsel_icerik',
  'tehdit',
  'kendine_zarar',
  'dolandiricilik',
  'diger',
];
export const AVATAR_COLORS = ['#ff0080', '#ff8c00', '#ffe000', '#00e676', '#00b0ff', '#c962ff', '#ff5252', '#40c4ff'];
export const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;

const username = z
  .string()
  .trim()
  .regex(USERNAME_RE, 'Rumuz 3-24 karakter olmalı; harf, rakam, _, . ve - kullanabilirsiniz.');
const email = z
  .string()
  .trim()
  .min(3, 'E-posta adresi gerekli.')
  .max(254, 'E-posta adresi çok uzun.')
  .pipe(z.email('Geçerli bir e-posta adresi girin.'))
  .transform((value) => value.toLowerCase());
const password = z.string().min(8, 'Parola en az 8 karakter olmalı.').max(200, 'Parola çok uzun.');
const displayName = z
  .string()
  .trim()
  .min(2, 'Görünen ad en az 2 karakter olmalı.')
  .max(40, 'Görünen ad en fazla 40 karakter olabilir.');
const bio = z.string().trim().max(300, 'Biyografi en fazla 300 karakter olabilir.');
const helpArea = z.enum(HELP_AREAS, { error: 'Geçersiz destek alanı.' }).nullish();
const positiveId = z.coerce.number().int().positive();
const limitParam = (max = 100, def = 20) => z.coerce.number().int().min(1).max(max).default(def);
const optionalText = (max) => z.string().trim().max(max).optional();
const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^(https?:\/\/|\/)[^\s]+$/.test(value), 'Kapak görseli bağlantısı geçersiz.');

export const schemas = {
  register: z.object({
    username,
    email,
    password,
    displayName: displayName.optional(),
    helpArea,
  }),
  login: z.object({
    identifier: z.string().trim().min(1, 'E-posta veya rumuz gerekli.').max(254),
    password: z.string().min(1, 'Parola gerekli.').max(200),
  }),
  profile: z.object({
    displayName: displayName.optional(),
    bio: bio.optional(),
    avatarColor: z.enum(AVATAR_COLORS, { error: 'Geçersiz renk.' }).optional(),
    helpArea: helpArea.optional(),
  }),
  changePassword: z.object({
    currentPassword: z.string().min(1, 'Mevcut parolanızı girin.').max(200),
    newPassword: password,
  }),
  confirmPassword: z.object({
    password: z.string().min(1, 'Parola gerekli.').max(200),
  }),
  createDm: z.object({ userId: positiveId }),
  messageBody: z.object({ body: z.string({ error: 'Mesaj metin olmalı.' }).max(20000, 'Mesaj çok uzun.') }),
  readMark: z.object({ lastMessageId: z.coerce.number().int().nonnegative().default(0) }),
  report: z.object({
    messageId: positiveId.nullish(),
    userId: positiveId.nullish(),
    reason: z.enum(REPORT_REASONS, { error: 'Geçersiz şikayet nedeni.' }),
    details: z.string().trim().max(1000, 'Açıklama en fazla 1000 karakter olabilir.').optional(),
  }),
  history: z.object({
    before: z.coerce.number().int().positive().optional(),
    after: z.coerce.number().int().nonnegative().optional(),
    limit: limitParam(100, 50),
  }),
  userSearch: z.object({
    q: optionalText(60),
    limit: limitParam(100, 30),
  }),
  pageQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: limitParam(100, 20),
    q: optionalText(100),
    status: optionalText(20),
    role: optionalText(20),
  }),
  blogQuery: z.object({
    q: optionalText(100),
    tag: optionalText(30),
    page: z.coerce.number().int().min(1).default(1),
    limit: limitParam(50, 9),
  }),
  comment: z.object({ body: z.string().trim().min(1, 'Yorum boş olamaz.').max(1000, 'Yorum en fazla 1000 karakter olabilir.') }),
  markdown: z.object({ body: z.string().max(60000).default('') }),
  postInput: z.object({
    title: z.string().trim().min(3, 'Başlık en az 3 karakter olmalı.').max(150, 'Başlık en fazla 150 karakter olabilir.'),
    slug: optionalText(80),
    excerpt: z.string().trim().max(300).default(''),
    bodyMd: z.string().max(60000, 'Yazı çok uzun.').default(''),
    coverUrl: safeUrl.nullish(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
    status: z.enum(['draft', 'published']).default('draft'),
  }),
  roomInput: z.object({
    name: z.string().trim().min(2, 'Oda adı en az 2 karakter olmalı.').max(60),
    slug: optionalText(60),
    description: z.string().trim().max(300).default(''),
    isReadonly: z.boolean().default(false),
    isArchived: z.boolean().default(false),
    sortOrder: z.coerce.number().int().min(-1000).max(1000).default(0),
  }),
  roomPatch: z.object({
    name: z.string().trim().min(2).max(60).optional(),
    slug: optionalText(60),
    description: z.string().trim().max(300).optional(),
    isReadonly: z.boolean().optional(),
    isArchived: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(-1000).max(1000).optional(),
  }),
  adminUserPatch: z.object({
    role: z.enum(ROLES, { error: 'Geçersiz rol.' }).optional(),
    status: z.enum(['active', 'banned'], { error: 'Geçersiz durum.' }).optional(),
    banReason: z.string().trim().max(300).optional(),
  }),
  resolveReport: z.object({
    outcome: z.enum(['resolved', 'dismissed'], { error: 'Geçersiz sonuç.' }),
    deleteMessage: z.boolean().default(false),
    banUser: z.boolean().default(false),
    note: z.string().trim().max(500).optional(),
  }),
  settingsPatch: z.object({
    announcement: z.string().trim().max(500).optional(),
    registrationOpen: z.boolean().optional(),
  }),
};
