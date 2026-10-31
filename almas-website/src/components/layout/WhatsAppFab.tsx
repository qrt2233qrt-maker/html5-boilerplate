import { site } from '@/config/site';
import { waLink } from '@/lib/whatsapp';
import { Icon } from '@/components/ui/Icon';

export function WhatsAppFab() {
  return (
    <a
      href={waLink(`مرحباً ${site.nameAr}، لدي استفسار`)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="تواصل عبر WhatsApp"
      className="group fixed bottom-5 start-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_10px_40px_-8px_rgba(16,185,129,.8)] transition-transform duration-300 hover:scale-110 active:scale-95"
    >
      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40 [animation-duration:2.5s]" />
      <Icon name="whatsapp" size={28} className="relative" />
    </a>
  );
}
