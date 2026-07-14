// آیکون‌های خطیِ سبک (stroke=currentColor) — بدون وابستگی خارجی
const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const S = ({ size = 24, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} {...p}>
    {children}
  </svg>
);

export const Pulse = (p) => (
  <S {...p}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </S>
);
export const Check = ({ size = 24, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.4} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const XMark = ({ size = 24, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.4} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const Chevron = (p) => (
  <S {...p}>
    <path d="m6 9 6 6 6-6" />
  </S>
);
export const ArrowLeft = (p) => (
  <S {...p}>
    <path d="M19 12H5m7-7-7 7 7 7" />
  </S>
);
export const Shield = (p) => (
  <S {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    <path d="m9 12 2 2 4-4" />
  </S>
);
export const Robot = (p) => (
  <S {...p}>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 8V4M9 2h6" />
    <circle cx="9" cy="14" r="1" />
    <circle cx="15" cy="14" r="1" />
  </S>
);
export const Users = (p) => (
  <S {...p}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9.5" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
  </S>
);
export const Chart = (p) => (
  <S {...p}>
    <path d="M3 3v18h18" />
    <path d="m7 15 4-6 4 3 5-8" />
  </S>
);
export const Terminal = (p) => (
  <S {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m6 8 4 3-4 3M12 15h6" />
  </S>
);
export const Chat = (p) => (
  <S {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </S>
);
export const Brand = (p) => (
  <S {...p}>
    <circle cx="13.5" cy="6.5" r="2.5" />
    <path d="M17 2h5v5M12 22a10 10 0 1 1 10-10" />
    <path d="M22 22l-5-5" />
  </S>
);
export const Box = (p) => (
  <S {...p}>
    <path d="M21 8v13H3V8" />
    <path d="M23 3H1v5h22V3z" />
    <path d="M10 12h4" />
  </S>
);
export const Hospital = (p) => (
  <S {...p}>
    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
    <path d="M12 8v3M10.5 9.5h3" />
  </S>
);
export const Phone = (p) => (
  <S {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </S>
);
export const Whatsapp = ({ size = 24, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);
export const Menu = (p) => (
  <S {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </S>
);
export const Face = (p) => (
  <S {...p}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <circle cx="9.5" cy="11" r=".6" fill="currentColor" />
    <circle cx="14.5" cy="11" r=".6" fill="currentColor" />
    <path d="M9.5 14.5a3.5 3.5 0 0 0 5 0" />
  </S>
);
