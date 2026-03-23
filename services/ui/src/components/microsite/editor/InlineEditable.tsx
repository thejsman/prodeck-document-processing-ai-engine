'use client';

/**
 * InlineEditable — like Editable but reads sectionId from SectionIdContext.
 * Drop this into any section component without threading sectionId through props.
 *
 * Usage:
 *   <InlineEditable field="headline" label="Headline" value={content.headline}>
 *     <Headline tokens={tokens}>{content.headline}</Headline>
 *   </InlineEditable>
 */

import { useSectionId } from './SectionIdContext';
import { Editable } from './Editable';

interface Props {
  field: string;
  label: string;
  value: string;
  children: React.ReactNode;
  multiline?: boolean;
  display?: 'block' | 'inline' | 'flex' | 'inline-block';
}

export function InlineEditable({ field, label, value, children, multiline, display }: Props) {
  const sectionId = useSectionId();

  // Outside editor context or no sectionId — render children as-is
  if (!sectionId) return <>{children}</>;

  return (
    <Editable
      sectionId={sectionId}
      fieldPath={field}
      elementType="text"
      label={label}
      value={value}
      multiline={multiline}
      display={display}
    >
      {children}
    </Editable>
  );
}
