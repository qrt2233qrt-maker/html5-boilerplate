import { useRef } from 'react';
import { useScrollFx } from '@/hooks/useScrollFx';
import { useCatalog } from '@/store/catalog';
import { Seo } from '@/components/ui/Seo';
import { Hero } from '@/components/home/Hero';
import { BrandMarquee } from '@/components/home/BrandMarquee';
import { LatestDevices } from '@/components/home/LatestDevices';
import { Accessories } from '@/components/home/Accessories';
import { ServicesPreview } from '@/components/home/ServicesPreview';
import { WhyUs } from '@/components/home/WhyUs';
import { Testimonials } from '@/components/home/Testimonials';
import { ContactSection } from '@/components/home/ContactSection';

export default function Home() {
  const ref = useRef<HTMLDivElement>(null);
  const status = useCatalog((s) => s.status);
  useScrollFx(ref, [status]);
  return (
    <div ref={ref}>
      <Seo />
      <Hero />
      <BrandMarquee />
      <LatestDevices />
      <Accessories />
      <ServicesPreview />
      <WhyUs />
      <Testimonials />
      <ContactSection />
    </div>
  );
}
