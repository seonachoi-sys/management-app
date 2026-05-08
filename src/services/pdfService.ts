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

  // ─── 캡처 전: 콘텐츠가 모두 보이도록 너비 자동 산출 ───
  // 1) maxWidth 해제 + width auto로 자연 너비 측정
  // 2) 표가 element보다 넓을 수 있으니 max(scrollWidth, captureWidth) 사용
  // 3) .pt-table-wrap의 overflow-x:auto도 visible로 강제 (캡처 시 잘림 방지)
  const originalStyle = {
    width: element.style.width,
    maxWidth: element.style.maxWidth,
    minWidth: element.style.minWidth,
    margin: element.style.margin,
  };

  // table-wrap의 overflow:auto를 visible로 임시 변경
  const wraps = element.querySelectorAll<HTMLElement>('.pt-table-wrap');
  const origOverflow: string[] = [];
  wraps.forEach((w) => {
    origOverflow.push(w.style.overflow);
    w.style.overflow = 'visible';
  });

  // 자연 너비 측정 (maxWidth 해제 후)
  element.style.maxWidth = 'none';
  element.style.minWidth = `${captureWidth}px`;
  element.style.width = `${captureWidth}px`;
  element.style.margin = '0';

  // 강제 리플로우 후 실제 콘텐츠 너비 확인
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  element.offsetHeight;
  const naturalWidth = Math.max(element.scrollWidth, captureWidth);
  if (naturalWidth > captureWidth) {
    // 콘텐츠가 더 넓으면 element를 그 폭으로 펼침
    element.style.width = `${naturalWidth}px`;
    element.style.minWidth = `${naturalWidth}px`;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    element.offsetHeight;
  }
  const finalCaptureWidth = naturalWidth;

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: finalCaptureWidth,
      windowWidth: finalCaptureWidth,
    });
  } finally {
    // 원본 스타일 복원
    element.style.width = originalStyle.width;
    element.style.maxWidth = originalStyle.maxWidth;
    element.style.minWidth = originalStyle.minWidth;
    element.style.margin = originalStyle.margin;
    wraps.forEach((w, i) => { w.style.overflow = origOverflow[i] || ''; });
  }

  const imgWidth = canvas.width;   // px (scale 적용됨)
  const imgHeight = canvas.height; // px

  // PDF 생성 — 압축 활성화
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });

  // PDF에서의 콘텐츠 크기 계산
  // ratio: 캔버스 1px = ?mm — 캡처된 실제 너비를 PDF contentWidth에 맞춤
  const elementWidthPx = imgWidth / scale; // = finalCaptureWidth
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
    // 안전 마진 — 행 잘림 방지를 위해 90%로 시작 (남은 10%는 픽셀 분석으로 미세 조정)
    const idealPagePx = Math.floor(pageContentPx * 0.90);

    // 캔버스 컨텍스트 (행 잘림 분석용)
    const srcCtx = canvas.getContext('2d');

    let yOffset = 0;
    let pageNum = 0;
    while (yOffset < imgHeight && pageNum < maxPages) {
      if (pageNum > 0) pdf.addPage();

      // 이상적 슬라이스 끝 위치
      const idealEnd = Math.min(yOffset + idealPagePx, imgHeight);

      // 마지막 페이지면 그대로, 아니면 흰색 가로줄 찾아서 그 위치에서 자르기
      let actualEnd = idealEnd;
      if (idealEnd < imgHeight && srcCtx) {
        actualEnd = findWhitespaceLine(srcCtx, imgWidth, idealEnd, Math.floor(pageContentPx * 0.10));
      }

      const sliceHeightPx = actualEnd - yOffset;
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

      yOffset = actualEnd;
      pageNum++;
    }
  }

  return pdf.output('blob');
}

/**
 * 캔버스에서 idealEnd 근처의 가장 흰색에 가까운 가로줄(행 사이 공백) 찾기.
 * idealEnd에서 위로 scanRange만큼 스캔하면서 평균 밝기가 가장 높은 y 위치 반환.
 * 표 행 사이 공백에서 자르도록 하여 행 중간 잘림 방지.
 */
function findWhitespaceLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  idealEnd: number,
  scanRange: number
): number {
  const minY = Math.max(0, idealEnd - scanRange);
  let bestY = idealEnd;
  let bestBrightness = -1;

  // 2px 간격으로 스캔 (성능)
  for (let y = idealEnd; y >= minY; y -= 2) {
    try {
      const data = ctx.getImageData(0, y, width, 1).data;
      // 평균 밝기 계산 (R+G+B 평균)
      let sum = 0;
      const sampleStep = Math.max(1, Math.floor(width / 200)); // 200개만 샘플링 (성능)
      let count = 0;
      for (let x = 0; x < width; x += sampleStep) {
        const idx = x * 4;
        sum += data[idx] + data[idx + 1] + data[idx + 2];
        count++;
      }
      const avg = sum / (count * 3);
      // 흰색에 가까울수록 점수 높음 + 이상 위치에 가까울수록 약간 가산
      const positionBonus = (1 - (idealEnd - y) / scanRange) * 5;
      const score = avg + positionBonus;
      if (score > bestBrightness) {
        bestBrightness = score;
        bestY = y;
      }
    } catch {
      break;
    }
  }
  return bestY;
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
