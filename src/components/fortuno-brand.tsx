import Image from "next/image";
export function FortunoWordmark({className,variant="white"}:{className?:string;variant?:"white"|"blue"}) {
  return <Image src={`/brand/fortuno-wordmark-${variant}.png`} alt="Fortuno Gestão Financeira" width={2560} height={variant === "white" ? 502 : 326} sizes="(max-width: 1024px) 70vw, 480px" priority className={className}/>;
}
