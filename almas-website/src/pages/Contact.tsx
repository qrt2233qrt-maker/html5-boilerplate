import { useRef } from 'react';
import { useScrollFx } from '@/hooks/useScrollFx';
import { Seo } from '@/components/ui/Seo';
import { ContactSection } from '@/components/home/ContactSection';

export default function Contact() {
  const ref = useRef<HTMLDivElement>(null);
  useScrollFx(ref);
  return (
    <div ref={ref}>
      <Seo title="تواصل معنا" path="/contact" description="عنوان الماس في الناصرية، ذي قار — الهاتف، WhatsApp، ساعات العمل والموقع على الخريطة." />
      <ContactSection standalone />
    </div>
  );
}
