declare module 'leaflet/dist/leaflet.css';

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
