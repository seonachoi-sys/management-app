/**
 * PDF 생성 서비스 — html2canvas + jsPDF
 * - JPEG 압축으로 파일 크기 감소
 * - element 너비 강제 (캡처 시 일관된 크기) → PDF에 가운데 정렬
 * - 페이지 분할 안정화 (행 중간 잘림 방지를 위한 안전 마진)
 * - 한글 지원: DOM 렌더링 → 이미지 캡처 → PDF 삽입
 */
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface PdfOptions {
  filename: string;
  orientation?: 'landscape' | 'portrait';
  margin?: number; // mm
  /** 캡처 시 element에 강제할 너비 (px). 기본 1100. PDF 가로 폭에 잘 맞는 크기. */
  captureWidth?: number;
  /** JPEG 품질 (0~1). 기본 0.85. 작을수록 파일 작음 */
  jpegQuality?: number;
  /** html2canvas 스케일. 기본 1.5 (선명도와 파일크기 균형) */
  scale?: number;
  /** 최대 페이지 수 (안전장치). 기본 50 */
  maxPages?: number;
}

/**
 * DOM 요소를 A4 PDF로 변환
 */
export async function generatePdfFromElement(
  element: HTMLElement,
  options: PdfOptions
): Promise<Blob> {
  const {
    orientation = 'landscape',
    margin = 8,
    captureWidth = 1100,
    jpegQuality = 0.85,
    scale = 1.5,
    maxPages = 50,
  } = options;

  // A4 크기 (mm)
  const a4Width = orientation === 'landscape' ? 297 : 210;
  const a4Height = orientation === 'landscape' ? 210 : 297;
  const contentWidth = a4Width - margin * 2;
  const contentHeight = a4Height - margin * 2;

  // ─── 캡처 전: element 너비 강제 적용 (일관된 PDF 출력 위함) ───
  const originalStyle = {
    width: element.style.width,
    maxWidth: element.style.maxWidth,
    minWidth: element.style.minWidth,
    margin: element.style.margin,
  };
  element.style.width = `${captureWidth}px`;
  element.style.maxWidth = `${captureWidth}px`;
  element.style.minWidth = `${captureWidth}px`;
  element.style.margin = '0';

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: captureWidth,
      windowWidth: captureWidth,
    });
  } finally {
    // 원본 스타일 복원
    element.style.width = originalStyle.width;
    element.style.maxWidth = originalStyle.maxWidth;
    element.style.minWidth = originalStyle.minWidth;
    element.style.margin = originalStyle.margin;
  }

  const imgWidth = canvas.width;   // px (scale 적용됨)
  const imgHeight = canvas.height; // px

  // PDF 생성 — 압축 활성화
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });

  // PDF에서의 콘텐츠 크기 계산
  // ratio: 캔버스 1px = ?mm
  const elementWidthPx = imgWidth / scale; // element의 실제 width (= captureWidth)
  const ratio = contentWidth / elementWidthPx;
  const scaledFullHeight = (imgHeight / scale) * ratio; // 전체를 PDF mm로

  // 가운데 정렬 위한 x 좌표
  const xPos = (a4Width - contentWidth) / 2;

  if (scaledFullHeight <= contentHeight) {
    // 1페이지에 다 들어감
    const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
    pdf.addImage(dataUrl, 'JPEG', xPos, margin, contentWidth, scaledFullHeight, undefined, 'FAST');
  } else {
    // 다중 페이지: 캔버스를 페이지 단위로 슬라이스
    // 페이지당 캔버스 픽셀 높이
    const pageContentPx = (contentHeight / ratio) * scale;
    // 안전 마진 — 행 중간 잘림 방지를 위해 살짝 줄임 (98%)
    const safePagePx = Math.floor(pageContentPx * 0.98);

    let yOffset = 0;
    let pageNum = 0;
    while (yOffset < imgHeight && pageNum < maxPages) {
      if (pageNum > 0) pdf.addPage();

      const sliceHeightPx = Math.min(safePagePx, imgHeight - yOffset);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = imgWidth;
      sliceCanvas.height = sliceHeightPx;
      const ctx = sliceCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, imgWidth, sliceHeightPx);
        ctx.drawImage(canvas, 0, -yOffset);
      }

      const sliceMm = (sliceHeightPx / scale) * ratio;
      const dataUrl = sliceCanvas.toDataURL('image/jpeg', jpegQuality);
      pdf.addImage(dataUrl, 'JPEG', xPos, margin, contentWidth, sliceMm, undefined, 'FAST');

      yOffset += sliceHeightPx;
      pageNum++;
    }
  }

  return pdf.output('blob');
}

/**
 * DOM 요소를 PDF 파일로 다운로드
 */
export async function downloadPdfFromElement(
  element: HTMLElement,
  options: PdfOptions
): Promise<void> {
  const blob = await generatePdfFromElement(element, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = options.filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * DOM 요소를 PDF Blob으로 반환 (ZIP용)
 */
export async function getPdfBlob(
  element: HTMLElement,
  options: PdfOptions
): Promise<Blob> {
  return generatePdfFromElement(element, options);
}
