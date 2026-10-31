// Dedicated SVG icons for templates (Duplicate, View, Delete)
export function TemplateDuplicateSvg({ width = 18, height = 18, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M6.66406 3.33341V13.3334C6.66406 13.7754 6.83966 14.1994 7.15222 14.5119C7.46478 14.8245 7.8887 15.0001 8.33073 15.0001H14.9974C15.4394 15.0001 15.8633 14.8245 16.1759 14.5119C16.4885 14.1994 16.6641 13.7754 16.6641 13.3334V6.03508C16.664 5.81305 16.6196 5.59326 16.5335 5.38862C16.4473 5.18398 16.3212 4.99862 16.1624 4.84341L13.3999 2.14175C13.0885 1.8373 12.6704 1.6668 12.2349 1.66675H8.33073C7.8887 1.66675 7.46478 1.84234 7.15222 2.1549C6.83966 2.46746 6.66406 2.89139 6.66406 3.33341V3.33341Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.332 15.0002V16.6668C13.332 17.1089 13.1564 17.5328 12.8439 17.8453C12.5313 18.1579 12.1074 18.3335 11.6654 18.3335H4.9987C4.55667 18.3335 4.13275 18.1579 3.82019 17.8453C3.50763 17.5328 3.33203 17.1089 3.33203 16.6668V7.50016C3.33203 7.05814 3.50763 6.63421 3.82019 6.32165C4.13275 6.00909 4.55667 5.8335 4.9987 5.8335H6.66536" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function TemplateDeleteSvg({ width = 18, height = 18, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M2.5 5.2355C2.15482 5.2355 1.875 5.51532 1.875 5.8605C1.875 6.20567 2.15482 6.4855 2.5 6.4855V5.2355ZM17.5 6.4855C17.8452 6.4855 18.125 6.20567 18.125 5.8605C18.125 5.51532 17.8452 5.2355 17.5 5.2355V6.4855ZM4.16667 5.8605V5.2355H3.54167V5.8605H4.16667ZM15.8333 5.8605H16.4583V5.2355H15.8333V5.8605ZM15.2849 14.0253L15.8853 14.1986L15.2849 14.0253ZM11.4366 17.3795L11.5408 17.9957L11.4366 17.3795ZM8.56334 17.3795L8.66748 16.7632L8.66748 16.7632L8.56334 17.3795ZM8.43189 17.3572L8.32775 17.9735H8.32775L8.43189 17.3572ZM4.71512 14.0252L4.11464 14.1986L4.71512 14.0252ZM11.5681 17.3572L11.464 16.741L11.5681 17.3572ZM6.53545 4.57449L7.10278 4.83672L6.53545 4.57449ZM7.34835 3.48427L6.93124 3.01881V3.01881L7.34835 3.48427ZM8.56494 2.7558L8.78243 3.34174L8.56494 2.7558ZM11.4351 2.7558L11.6526 2.16987V2.16987L11.4351 2.7558ZM13.4645 4.57449L14.0319 4.31226L13.4645 4.57449ZM2.5 6.4855H17.5V5.2355H2.5V6.4855ZM11.464 16.741L11.3325 16.7632L11.5408 17.9957L11.6722 17.9735L11.464 16.741ZM8.66748 16.7632L8.53603 16.741L8.32775 17.9735L8.4592 17.9957L8.66748 16.7632ZM15.2083 5.8605V10.1465H16.4583V5.8605H15.2083ZM4.79167 10.1465V5.8605H3.54167V10.1465H4.79167ZM15.2083 10.1465C15.2083 11.4005 15.0319 12.648 14.6844 13.8519L15.8853 14.1986C16.2654 12.882 16.4583 11.5177 16.4583 10.1465H15.2083ZM11.3325 16.7632C10.4503 16.9123 9.54967 16.9123 8.66748 16.7632L8.4592 17.9957C9.47927 18.1681 10.5207 18.1681 11.5408 17.9957L11.3325 16.7632ZM8.53603 16.741C7.00436 16.4821 5.75131 15.3612 5.3156 13.8519L4.11464 14.1986C4.68231 16.1651 6.31805 17.6339 8.32775 17.9735L8.53603 16.741ZM5.3156 13.8519C4.96808 12.648 4.79167 11.4005 4.79167 10.1465H3.54167C3.54167 11.5177 3.73457 12.8819 4.11464 14.1986L5.3156 13.8519ZM11.6722 17.9735C13.6819 17.6339 15.3177 16.1651 15.8853 14.1986L14.6844 13.8519C14.2487 15.3612 12.9956 16.4821 11.464 16.741L11.6722 17.9735ZM6.875 5.86049C6.875 5.51139 6.95162 5.16374 7.10278 4.83672L5.96813 4.31226C5.74237 4.80066 5.625 5.32698 5.625 5.86049H6.875ZM7.10278 4.83672C7.25406 4.50944 7.47797 4.20734 7.76546 3.94972L6.93124 3.01881C6.52229 3.38529 6.19376 3.82411 5.96813 4.31226L7.10278 4.83672ZM7.76546 3.94972C8.05308 3.69197 8.39813 3.48439 8.78243 3.34174L8.34744 2.16987C7.8218 2.36498 7.34006 2.65246 6.93124 3.01881L7.76546 3.94972ZM8.78243 3.34174C9.16676 3.19908 9.58067 3.125 10 3.125V1.875C9.43442 1.875 8.87306 1.97476 8.34744 2.16987L8.78243 3.34174ZM10 3.125C10.4193 3.125 10.8332 3.19908 11.2176 3.34174L11.6526 2.16987C11.1269 1.97476 10.5656 1.875 10 1.875V3.125ZM11.2176 3.34174C11.6019 3.48439 11.9469 3.69198 12.2345 3.94972L13.0688 3.01881C12.6599 2.65246 12.1782 2.36498 11.6526 2.16987L11.2176 3.34174ZM12.2345 3.94972C12.522 4.20735 12.7459 4.50944 12.8972 4.83672L14.0319 4.31226C13.8062 3.82411 13.4777 3.38529 13.0688 3.01881L12.2345 3.94972ZM12.8972 4.83672C13.0484 5.16374 13.125 5.51139 13.125 5.8605H14.375C14.375 5.32698 14.2576 4.80066 14.0319 4.31226L12.8972 4.83672ZM4.16667 6.4855H15.8333V5.2355H4.16667V6.4855Z" fill="currentColor"/>
      <path d="M8.33203 10V13.3333M11.6654 10V13.3333" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  );
}

export function TemplateViewSvg({ width = 18, height = 18, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M2 10C3.8 6.5 6.5 4.5 10 4.5C13.5 4.5 16.2 6.5 18 10C16.2 13.5 13.5 15.5 10 15.5C6.5 15.5 3.8 13.5 2 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );
}

export function TemplateDraftSvg({ width = 18, height = 18, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M4 2.5H11L16 7.5V16.5C16 17.3284 15.3284 18 14.5 18H4C3.17157 18 2.5 17.3284 2.5 16.5V4C2.5 3.17157 3.17157 2.5 4 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M11 2.5V7.5H16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M5.5 11H13.5M5.5 14H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function TemplateSearchSvg({ width = 18, height = 18, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function TemplateCreateSvg({ width = 18, height = 18, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M4 2.5H11L15 6.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M11 2.5V6.5H15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M4 2.5C3.17157 2.5 2.5 3.17157 2.5 4V16C2.5 16.8284 3.17157 17.5 4 17.5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M11.5 15.5L15.8 11.2C16.1866 10.8134 16.8134 10.8134 17.2 11.2C17.5866 11.5866 17.5866 12.2134 17.2 12.6L12.9 16.9L10.5 17.5L11.5 15.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function BookDemoSvg({ width = 16, height = 16, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 6.5L13 10L8 13.5V6.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function NavConnectSvg({ width = 18, height = 18, fill = 'currentColor', className = '' }: { width?: number; height?: number; fill?: string; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M19.7803 1.28033C20.0732 0.987437 20.0732 0.512563 19.7803 0.21967C19.4874 -0.0732233 19.0126 -0.0732233 18.7197 0.21967L16.7077 2.23161C15.0483 1.05263 12.7323 1.20693 11.2448 2.6945L10.1767 3.76252C9.49333 4.44594 9.49333 5.55398 10.1767 6.2374L13.7625 9.82318C14.446 10.5066 15.554 10.5066 16.2374 9.82318L17.3054 8.75517C18.793 7.26761 18.9473 4.9517 17.7684 3.29228L19.7803 1.28033ZM16.1945 3.75516L16.2173 3.77798L16.2197 3.78033L16.222 3.78267L16.2448 3.80542C17.3187 4.87936 17.3187 6.62056 16.2448 7.6945L15.1767 8.76252C15.0791 8.86016 14.9208 8.86016 14.8232 8.76252L11.2374 5.17674C11.1398 5.07911 11.1398 4.92082 11.2374 4.82318L12.3054 3.75516C13.3794 2.68122 15.1206 2.68122 16.1945 3.75516ZM8.78033 9.28033C9.07322 8.98744 9.07322 8.51256 8.78033 8.21967C8.48744 7.92678 8.01256 7.92678 7.71967 8.21967L6.00001 9.93933L5.53035 9.46967C5.23746 9.17678 4.76258 9.17678 4.46969 9.46967L2.69456 11.2448C1.20701 12.7324 1.0527 15.0483 2.23163 16.7077L0.21967 18.7197C-0.0732233 19.0126 -0.0732233 19.4874 0.21967 19.7803C0.512563 20.0732 0.987437 20.0732 1.28033 19.7803L3.29229 17.7684C4.95171 18.9473 7.26766 18.793 8.75522 17.3055L10.5303 15.5303C10.8232 15.2374 10.8232 14.7626 10.5303 14.4697L10.0607 14L11.7803 12.2803C12.0732 11.9874 12.0732 11.5126 11.7803 11.2197C11.4874 10.9268 11.0126 10.9268 10.7197 11.2197L9.00001 12.9393L7.06067 11L8.78033 9.28033ZM5.46631 11.527L5.46967 11.5303L5.47305 11.5337L8.46638 14.527L8.46967 14.5303L8.47298 14.5336L8.93936 15L7.69456 16.2448C6.62062 17.3187 4.87942 17.3187 3.80548 16.2448L3.75522 16.1945C2.68128 15.1206 2.68128 13.3794 3.75522 12.3055L5.00002 11.0607L5.46631 11.527Z" fill={fill}/>
    </svg>
  );
}

export function BuyNowSvg({ width = 18, height = 18, stroke = 'currentColor', className = '' }: { width?: number; height?: number; stroke?: string; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M2.5 8.33334H17.5M4.16667 15.8333H15.8333C16.7538 15.8333 17.5 15.0872 17.5 14.1667V5.83334C17.5 4.91286 16.7538 4.16667 15.8333 4.16667H4.16667C3.24619 4.16667 2.5 4.91286 2.5 5.83334V14.1667C2.5 15.0872 3.24619 15.8333 4.16667 15.8333Z" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function CalendarSvg({ width = 20, height = 20, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6.5 2.5V6.5M13.5 2.5V6.5M3 8H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M6.5 11H6.51M10 11H10.01M13.5 11H13.51M6.5 14H6.51M10 14H10.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function AddToListSvg({ width = 20, height = 20, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M10 6V14M6 10H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function UploadSvg({ width = 20, height = 20, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M10 13V3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6.5 7L10 3.5L13.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 12.5V15.5C4 16.3284 4.67157 17 5.5 17H14.5C15.3284 17 16 16.3284 16 15.5V12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function CancelIconSvg({ width = 20, height = 20, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M7 7L13 13M13 7L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function SendNowSvg({ width = 20, height = 20, className = '', color = '#23A455' }: { width?: number; height?: number; className?: string; color?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path
        d="M17.6469 7.54313L4.8136 1.12646C4.30714 0.874384 3.73525 0.784643 3.17592 0.869473C2.61658 0.954302 2.09702 1.20957 1.68807 1.60048C1.27912 1.99139 1.00068 2.49891 0.890721 3.05385C0.780757 3.60879 0.84462 4.18414 1.0736 4.70146L3.2736 9.62396C3.32352 9.74297 3.34923 9.87074 3.34923 9.99979C3.34923 10.1288 3.32352 10.2566 3.2736 10.3756L1.0736 15.2981C0.887244 15.7168 0.808462 16.1754 0.844415 16.6322C0.880368 17.0891 1.02992 17.5297 1.27947 17.914C1.52902 18.2984 1.87067 18.6143 2.27336 18.833C2.67605 19.0517 3.12701 19.1663 3.58527 19.1665C4.01448 19.1622 4.4373 19.062 4.82277 18.8731L17.6561 12.4565C18.1113 12.2275 18.494 11.8765 18.7613 11.4427C19.0287 11.0089 19.1703 10.5094 19.1703 9.99979C19.1703 9.49022 19.0287 8.99068 18.7613 8.55689C18.494 8.1231 18.1113 7.77212 17.6561 7.54313H17.6469ZM16.8311 10.8156L3.99777 17.2323C3.82925 17.3132 3.64002 17.3407 3.45546 17.311C3.27089 17.2813 3.09981 17.1959 2.96516 17.0662C2.8305 16.9366 2.73871 16.7688 2.70209 16.5855C2.66547 16.4022 2.68577 16.2121 2.76027 16.0406L4.9511 11.1181C4.97946 11.0524 5.00395 10.9851 5.02444 10.9165H11.3403C11.5834 10.9165 11.8165 10.8199 11.9884 10.648C12.1604 10.4761 12.2569 10.2429 12.2569 9.99979C12.2569 9.75668 12.1604 9.52352 11.9884 9.35161C11.8165 9.1797 11.5834 9.08313 11.3403 9.08313H5.02444C5.00395 9.01453 4.97946 8.94719 4.9511 8.88146L2.76027 3.95896C2.68577 3.78751 2.66547 3.59738 2.70209 3.41406C2.73871 3.23075 2.8305 3.06301 2.96516 2.93334C3.09981 2.80368 3.27089 2.71828 3.45546 2.6886C3.64002 2.65892 3.82925 2.68638 3.99777 2.76729L16.8311 9.18396C16.9813 9.26088 17.1073 9.37776 17.1953 9.5217C17.2832 9.66565 17.3298 9.83108 17.3298 9.99979C17.3298 10.1685 17.2832 10.3339 17.1953 10.4779C17.1073 10.6218 16.9813 10.7387 16.8311 10.8156Z"
        fill={color}
      />
    </svg>
  );
}

export function ContactsSvg({ width = 18, height = 18, className = '' }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M14 17V15.5C14 14.1193 12.8807 13 11.5 13H5.5C4.11929 13 3 14.1193 3 15.5V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="8.5" cy="6.5" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M14 7C15.1046 7 16 7.89543 16 9C16 10.1046 15.1046 11 14 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M17 17V15.8C17 14.65 16.3 13.65 15.2 13.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
