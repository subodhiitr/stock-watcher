declare module 'qrcode' {
  type QrCode = Readonly<{
    modules: Readonly<{
      size: number
      get(row: number, column: number): boolean
    }>
  }>

  const QRCode: Readonly<{
    create(value: string, options?: Readonly<{ errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }>): QrCode
  }>

  export default QRCode
}
