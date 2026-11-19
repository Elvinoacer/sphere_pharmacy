"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  Plus,
  Upload,
  MessageCircle,
  MapPin,
  ShieldCheck,
  Truck,
  Heart,
  ChevronDown,
} from "lucide-react";
import { useAppStore } from "@/store/use-app-store";
import { SphereHeader } from "@/components/layout/sphere-header";
import { servicesApi } from "@/lib/api-client";
import { isImagePath } from "@/lib/image";
import type { ServiceDTO } from "@/lib/types";
import { PHARMACY, waLink } from "@/lib/constants";
import styles from "./sphere-landing.module.css";

const categories = [
  {
    name: "Everyday essentials",
    note: "The little things that keep you going.",
    image: "cat-otc",
    query: "",
    color: "mint",
  },
  {
    name: "Vitamins & wellness",
    note: "Make feeling good a daily ritual.",
    image: "cat-vitamins",
    query: "vitamin",
    color: "yellow",
  },
  {
    name: "Skin & self-care",
    note: "A little care. A little you-time.",
    image: "cat-skin-care",
    query: "skin",
    color: "pink",
  },
  {
    name: "Mother & baby",
    note: "For your whole little world.",
    image: "cat-mother-baby",
    query: "baby",
    color: "blue",
  },
];


type CarePreview = {
  id?: string;
  name: string;
  description: string;
  category: string;
  image: string;
  fallbackImage: string;
  durationMinutes?: number;
};

const CARE_PREVIEWS: CarePreview[] = [
  {
    name: "Medication reviews",
    description: "Talk through your medicines and dosage schedule with our pharmacy team.",
    category: "Pharmacist consultation",
    image: "/images/pharmacist-consult.png",
    fallbackImage: "/images/pharmacist-consult.png",
  },
  {
    name: "Blood pressure checks",
    description: "A convenient blood pressure and pulse check, with guidance on your next steps.",
    category: "Wellness checks",
    image: "/images/categories/cat-heart-health.webp",
    fallbackImage: "/images/categories/cat-heart-health.webp",
  },
  {
    name: "Blood glucose screening",
    description: "Check your blood sugar and discuss the results with the care team.",
    category: "Health screening",
    image: "/images/categories/cat-diabetes.webp",
    fallbackImage: "/images/categories/cat-diabetes.webp",
  },
];

function fallbackServiceImage(name: string, category?: string | null): string {
  const label = `${name} ${category || ""}`.toLowerCase();
  if (/blood pressure|heart|cardio/.test(label)) return "/images/categories/cat-heart-health.webp";
  if (/glucose|diabet|blood sugar/.test(label)) return "/images/categories/cat-diabetes.webp";
  if (/screen|test|diagnos|laboratory/.test(label)) return "/images/categories/cat-diagnostics.webp";
  if (/prescription|refill/.test(label)) return "/images/categories/cat-prescription.webp";
  return "/images/pharmacist-consult.png";
}

function servicePreview(service: ServiceDTO): CarePreview {
  const fallbackImage = fallbackServiceImage(service.name, service.category);
  const image = service.heroImage || service.images?.find((item) => isImagePath(item.url))?.url || fallbackImage;
  return {
    id: service.id,
    name: service.name,
    description: service.shortDescription || service.description || "Personalised care and guidance from our pharmacy team.",
    category: service.category || "Pharmacy care",
    image,
    fallbackImage,
    durationMinutes: service.durationMinutes,
  };
}

function CareServicePhoto({ src, fallback, name }: { src: string; fallback: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <Image
      src={!failed && isImagePath(src) ? src : fallback}
      alt={`${name} care service`}
      fill
      unoptimized
      sizes="(max-width: 640px) 92vw, (max-width: 960px) 46vw, 55vw"
      onError={() => setFailed(true)}
    />
  );
}

export function SphereLanding() {
  const navigate = useAppStore((s) => s.navigate);
  const setFilters = useAppStore((s) => s.setCatalogFilters);
  const resetFilters = useAppStore((s) => s.resetCatalogFilters);
  const [query, setQuery] = useState("");
  const [liveServices, setLiveServices] = useState<ServiceDTO[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    servicesApi.list()
      .then((data) => {
        if (!cancelled) setLiveServices(data.filter((service) => service.active).slice(0, 3));
      })
      .catch(() => {
        // Keep the pictured care previews when the public service feed is temporarily unavailable.
      });
    return () => { cancelled = true; };
  }, []);

  const careCards: CarePreview[] = liveServices?.length
    ? liveServices.map(servicePreview)
    : CARE_PREVIEWS;
  function shop(search = "") {
    resetFilters();
    setFilters({ search });
    navigate("catalog");
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    shop(query.trim());
  }
  return (
    <div className={styles.landing}>
      <div className={styles.topline}>
        <span>GOOD HEALTH. CLOSE TO HOME.</span>
        <a href={PHARMACY.mapsUrl} target="_blank" rel="noreferrer">
          <MapPin size={12} /> Roysambu, Nairobi <ArrowUpRight size={12} />
        </a>
      </div>
      <SphereHeader />
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span /> YOUR NEIGHBOURHOOD. YOUR WELLBEING.
          </p>
          <h1 id="hero-title">
            A little care.
            <br />A whole lot
            <br />
            of <em>better.</em>
            <span className={styles.titleStar} aria-hidden="true">
              ✳
            </span>
          </h1>
          <p className={styles.intro}>
            Your everyday essentials, expert guidance, and a pharmacy that knows
            you. All in your corner.
          </p>
          <div className={styles.heroActions}>
            <button className={styles.primary} onClick={() => shop()}>
              Find your feel-good <ArrowUpRight size={20} />
            </button>
            <button
              className={styles.secondary}
              onClick={() => navigate("prescriptions")}
            >
              <Upload size={17} /> Upload prescription
            </button>
          </div>
          <div className={styles.heroFoot}>
            <span>
              <ShieldCheck size={17} /> Pharmacist-reviewed prescriptions
            </span>
            <span>
              <Truck size={17} /> Delivery or pickup
            </span>
          </div>
        </div>
        <div
          className={styles.art}
          role="img"
          aria-label="Sculptural green sphere surrounded by orbiting circles, a pharmacy cross, and everyday care essentials"
        >
          <div className={styles.artGrid} />
          <span className={styles.artLabel}>THE SPHERE OF CARE</span>
          <div className={styles.orbitOne} />
          <div className={styles.orbitSatellite} aria-hidden="true">
            <span />
          </div>
          <div className={styles.orbitTwo} />
          <div className={styles.orbitThree} />
          <div className={styles.sphere}>
            <div className={styles.sphereShine} />
            <Plus className={styles.sphereCross} strokeWidth={1.4} />
            <span>care, all around.</span>
          </div>
          <div className={styles.floatLabel}>
            <span className={styles.smallCross}>
              <Plus size={21} />
            </span>
            <div>
              A healthier everyday.<small>Starts with a little care.</small>
            </div>
          </div>
          <div className={styles.capsule}>
            <span />
            <span />
          </div>
          <div className={styles.littleOrb} />
          <div className={styles.careSeal}>
            <Heart size={22} />
            <span>
              HUMAN FIRST.
              <br />
              ALWAYS.
            </span>
          </div>
          <span className={styles.artCoordinates}>
            01°13′ S &nbsp; 36°53′ E
          </span>
          <span className={styles.artBottom}>ROOTED IN ROYSAMBU ↗</span>
        </div>
      </section>
      <section
        className={styles.searchSection}
        aria-label="Find health products"
      >
        <div>
          <span className={styles.eyebrow}>LET’S FIND YOUR ESSENTIALS</span>
          <p>What’s on your care list?</p>
        </div>
        <form onSubmit={submit} className={styles.search}>
          <Search size={20} />
          <label className={styles.srOnly} htmlFor="health-search">
            Search medicines and health essentials
          </label>
          <input
            id="health-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search medicines, vitamins, skincare…"
            type="search"
          />
          <button type="submit" aria-label="Search products">
            <ArrowRight size={22} />
          </button>
        </form>
      </section>
      <section className={styles.careServices} data-reveal>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>
              THERE’S MORE TO YOUR NEIGHBOURHOOD PHARMACY
            </p>
            <h2>
              A little check-in.
              <br />
              <em>A lot of peace of mind.</em>
            </h2>
          </div>
          <button
            className={styles.textLink}
            onClick={() => navigate("services")}
          >
            All care services <ArrowUpRight size={19} />
          </button>
        </div>
        <div className={styles.careServiceGrid}>
          {careCards.map((service, index) => (
            <button
              key={service.id || service.name}
              type="button"
              aria-label={`Explore ${service.name}`}
              onClick={() => navigate("services", service.id ? { previewServiceId: service.id } : {})}
              className={styles.careServiceCard}
            >
              <span className={styles.careServiceImage} aria-hidden="true">
                <CareServicePhoto src={service.image} fallback={service.fallbackImage} name={service.name} />
              </span>
              <span className={styles.careServiceShade} aria-hidden="true" />
              <span className={styles.careServiceTop}>
                <span className={styles.careServiceCategory}>{service.category}</span>
                <span className={styles.careServiceNumber}>0{index + 1}</span>
              </span>
              <div className={styles.careServiceBody}>
                {service.durationMinutes ? (
                  <span className={styles.careServiceDuration}>{service.durationMinutes} min · In-pharmacy care</span>
                ) : null}
                <h3>{service.name}</h3>
                <span className={styles.careServiceDescription}>{service.description}</span>
                <span className={styles.serviceExplore}>
                  <span>Explore &amp; book</span>
                  <span className={styles.careServiceArrow}><ArrowUpRight size={19} strokeWidth={1.7} /></span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className={styles.categories} data-reveal>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>LIFE HAPPENS. WE’RE HERE.</p>
            <h2>
              Care for every
              <br />
              <em>version of you.</em>
            </h2>
          </div>
          <button className={styles.textLink} onClick={() => shop()}>
            Explore the shop <ArrowUpRight size={19} />
          </button>
        </div>
        <div className={styles.categoryGrid}>
          {categories.map((category, i) => (
            <button
              key={category.name}
              onClick={() => shop(category.query)}
              className={`${styles.category} ${styles[category.color]}`}
            >
              <div className={styles.categoryTop}>
                <span>0{i + 1}</span>
                <ArrowUpRight size={22} />
              </div>
              <div className={styles.categoryImage}>
                <Image
                  src={`/images/categories/${category.image}.webp`}
                  alt=""
                  fill
                  sizes="(max-width: 600px) 45vw, 23vw"
                />
              </div>
              <h3>{category.name}</h3>
              <p>{category.note}</p>
            </button>
          ))}
        </div>
      </section>
      <section className={styles.prescription} data-reveal>
        <div className={styles.rxGraphic} aria-hidden="true">
          <div className={styles.rxPaper}>
            <span>sphere +</span>
            <strong>Rx</strong>
            <i />
            <i />
            <i />
            <div>
              <ShieldCheck /> Reviewed with care
            </div>
          </div>
          <div className={styles.rxBadge}>
            <Upload size={27} />
          </div>
          <span className={styles.rxStar}>✳</span>
        </div>
        <div className={styles.rxCopy}>
          <p className={styles.eyebrow}>LESS RUNNING AROUND. MORE REST.</p>
          <h2>
            Your prescription.
            <br />
            <em>Our personal attention.</em>
          </h2>
          <p>
            Send us your prescription. Our pharmacy team will review it, confirm
            availability, and help you arrange delivery or pickup.
          </p>
          <button
            className={styles.primary}
            onClick={() => navigate("prescriptions")}
          >
            Upload your prescription <ArrowUpRight size={20} />
          </button>
          <small>Dispensed only after pharmacist verification.</small>
        </div>
      </section>
      <section className={styles.steps} id="how-it-works" data-reveal>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>A LITTLE SIMPLER, BY DESIGN</p>
            <h2>
              Good care.
              <br />
              <em>Without the extra steps.</em>
            </h2>
          </div>
          <span className={styles.stepsStar} aria-hidden="true">
            ✳
          </span>
        </div>
        <div className={styles.stepGrid}>
          {[
            {
              title: "Find what you need",
              text: "Browse your daily essentials or upload a prescription for our team to review.",
            },
            {
              title: "Make it yours",
              text: "Choose delivery or pickup. Check your order and pay with M-Pesa or card.",
            },
            {
              title: "We’ll take it from here",
              text: "Follow your order from your account. Need a hand? Our team is a message away.",
            },
          ].map((step, i) => (
            <article key={step.title}>
              <span className={styles.stepNumber}>
                0{i + 1}
                <ArrowRight size={20} />
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className={styles.visit} data-reveal>
        <div>
          <p className={styles.eyebrow}>ONLINE CONVENIENCE. REAL PEOPLE.</p>
          <h2>
            Just around
            <br />
            <em>your corner.</em>
          </h2>
          <p>
            Pop in, say hello, ask that question.
            <br />
            We’re your neighbours first.
          </p>
          <a
            href={PHARMACY.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.primary}
          >
            Come find us <ArrowUpRight size={20} />
          </a>
        </div>
        <div className={styles.visitDetails}>
          <MapPin size={32} />
          <h3>
            Lumumba Drive,
            <br />
            Roysambu.
          </h3>
          <p>Nairobi, Kenya</p>
          <div className={styles.visitLine} />
          <span>{PHARMACY.hoursLabel}</span>
          <a href={`tel:${PHARMACY.phone}`}>
            {PHARMACY.phoneDisplay} <ArrowUpRight size={20} />
          </a>
        </div>
      </section>
      <section className={styles.faq} data-reveal>
        <p className={styles.eyebrow}>A FEW HELPFUL ANSWERS</p>
        <h2>
          Wondering about <em>something?</em>
        </h2>
        {[
          {
            q: "Can I order prescription medicine online?",
            a: "Yes. Upload your prescription for pharmacist review. Our team will confirm availability and the next steps before dispensing.",
          },
          {
            q: "Can I collect my order at the pharmacy?",
            a: "Yes. Choose pickup at checkout and follow your order status in your account. Visit us on Lumumba Drive, Roysambu, once your order is ready.",
          },
          {
            q: "How do I find out my delivery fee?",
            a: "Delivery options and the applicable fee are shown at checkout based on your location. Contact the team if you need help checking your address.",
          },
        ].map((item) => (
          <details key={item.q}>
            <summary>
              {item.q}
              <ChevronDown size={20} />
            </summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>
      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <h2>
            Here’s to feeling
            <br />
            <em>more like you.</em>
          </h2>
          <a href={waLink()} className={styles.primary}>
            <MessageCircle size={20} /> Talk to our team{" "}
            <ArrowUpRight size={20} />
          </a>
        </div>
        <div className={styles.footerWord} aria-hidden="true">
          sphere<span>✳</span>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} Sphere Pharmacy</span>
          <span>A little care goes a long way.</span>
          <button onClick={() => navigate("offers")}>
            Current offers <ArrowUpRight size={14} />
          </button>
          <button onClick={() => navigate("account")}>
            My account <ArrowUpRight size={14} />
          </button>
        </div>
      </footer>
    </div>
  );
}
