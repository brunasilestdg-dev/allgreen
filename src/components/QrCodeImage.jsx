import { useEffect, useState } from "react";

// ===== QR Code gerado no próprio aparelho =====
//
// Usa a lib `qrcode`, que o app já carregava só no Kit Criativo. Import
// dinâmico: ela só é baixada quando alguma tela realmente mostra um QR.
//
// Falha nunca trava a tela: sem canvas (ou com a lib indisponível) o QR some
// e o que já existia ao lado — o "copia e cola", o link — continua valendo.
export default function QrCodeImage({ value, size = 220, label, fileName = "" }) {
  const [gerado, setGerado] = useState({ value: "", url: "", falhou: false });

  useEffect(() => {
    if (!value) return undefined;
    let vivo = true;
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(value, {
          errorCorrectionLevel: "M",
          width: size * 2,
          margin: 2,
        }),
      )
      .then((url) => {
        if (vivo) setGerado({ value, url, falhou: false });
      })
      .catch(() => {
        if (vivo) setGerado({ value, url: "", falhou: true });
      });
    return () => {
      vivo = false;
    };
  }, [value, size]);

  // O estado é do valor em que foi gerado: trocou o valor, o QR antigo não
  // pode continuar na tela enquanto o novo não fica pronto.
  const atual = gerado.value === value ? gerado : { url: "", falhou: false };
  if (!value || atual.falhou) return null;
  if (!atual.url)
    return (
      <div
        className="qr-image qr-image-loading"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  return (
    <figure className="qr-image">
      <img src={atual.url} width={size} height={size} alt={label} />
      {fileName && (
        <a className="btn ghost" href={atual.url} download={fileName}>
          Baixar QR Code
        </a>
      )}
    </figure>
  );
}
