import CourantApp from "../components/courant-app";
export default function Page() {
  return <CourantApp supportWhatsAppPhone={process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_PHONE} />;
}
