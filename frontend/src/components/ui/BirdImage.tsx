interface Props {
  url: string;
  alt: string;
}

export function BirdImage({ url, alt }: Props) {
  return (
    <div className="w-full rounded-xl overflow-hidden bg-slate-100 mb-6">
      <img
        src={url}
        alt={alt}
        className="w-full object-cover max-h-64"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    </div>
  );
}
