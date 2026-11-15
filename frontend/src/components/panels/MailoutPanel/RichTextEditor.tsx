import { useCallback, useEffect, useRef } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { mailoutImageBase, pickImageFiles, MAILOUT_IMAGE_TYPES } from '../../../lib/mailout';

interface Props {
  /** Called on every change with the editor's HTML and whether it has any content. */
  onChange: (html: string, isEmpty: boolean) => void;
  disabled?: boolean;
  /** Uploads a pasted, dropped or chosen image; rejects with a user-facing message. */
  uploadImage: (file: File) => Promise<{ src: string; width: number }>;
  onImageError: (message: string) => void;
}

const IMAGE_BASE = mailoutImageBase((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '');

/**
 * Images from our bucket only. Others (e.g. in HTML pasted from a web page) are left out here,
 * as the server would drop them from the email anyway.
 */
const MailoutImage = Image.extend({
  parseHTML() {
    return [{
      tag: 'img[src]',
      getAttrs: el => ((el as HTMLElement).getAttribute('src') ?? '').startsWith(IMAGE_BASE) ? null : false,
    }];
  },
}).configure({ inline: false, allowBase64: false });

/** Only formatting the server keeps for emails (see backend/src/lib/mailout.ts ALLOWED_TAGS). */
const extensions = [
  StarterKit.configure({
    code:      false,
    codeBlock: false,
    heading:   { levels: [1, 2, 3] },
    link:      { openOnClick: false, autolink: true, defaultProtocol: 'https' },
  }),
  MailoutImage,
];

// Tailwind's reset strips heading/list styles, so the editor's content is styled here.
const CONTENT_STYLES = [
  '[&_.ProseMirror]:min-h-[220px] [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2 [&_.ProseMirror]:outline-none',
  '[&_.ProseMirror]:text-sm [&_.ProseMirror]:text-slate-800',
  '[&_.ProseMirror_p]:mb-3 [&_.ProseMirror_p]:leading-relaxed',
  '[&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:text-forest-700 [&_.ProseMirror_h1]:mt-4 [&_.ProseMirror_h1]:mb-2',
  '[&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:text-forest-700 [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-2',
  '[&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-bold [&_.ProseMirror_h3]:text-forest-700 [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1',
  '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ul]:mb-3 [&_.ProseMirror_ol]:mb-3',
  '[&_.ProseMirror_li_p]:mb-1',
  '[&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-forest-500 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-slate-600 [&_.ProseMirror_blockquote]:my-3',
  '[&_.ProseMirror_hr]:my-4 [&_.ProseMirror_hr]:border-slate-300',
  '[&_.ProseMirror_a]:text-forest-700 [&_.ProseMirror_a]:underline',
  '[&_.ProseMirror_img]:my-3 [&_.ProseMirror_img.ProseMirror-selectednode]:ring-2 [&_.ProseMirror_img.ProseMirror-selectednode]:ring-forest-500',
].join(' ');

function ToolbarButton({ label, title, active, disabled, onClick }: {
  label: string; title: string; active?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()} // keep the editor's selection
      onClick={onClick}
      className={`min-w-[28px] h-7 px-1.5 rounded text-xs font-semibold disabled:opacity-40 ${
        active ? 'bg-forest-600 text-white' : 'text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function setLink(editor: Editor) {
  const current = editor.getAttributes('link').href as string | undefined;
  const url = window.prompt('Link address (leave empty to remove the link)', current ?? 'https://');
  if (url === null) return;
  const trimmed = url.trim();
  if (!trimmed || trimmed === 'https://') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
  } else {
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
  }
}

function setImageAlt(editor: Editor) {
  const current = (editor.getAttributes('image').alt as string | null) ?? '';
  const alt = window.prompt('Describe this image (shown when images are blocked, and read aloud by screen readers)', current);
  if (alt === null) return;
  editor.chain().focus().updateAttributes('image', { alt: alt.trim() }).run();
}

function Toolbar({ editor, disabled, onPickImage }: { editor: Editor; disabled?: boolean; onPickImage: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold:       e.isActive('bold'),
      italic:     e.isActive('italic'),
      underline:  e.isActive('underline'),
      strike:     e.isActive('strike'),
      h1:         e.isActive('heading', { level: 1 }),
      h2:         e.isActive('heading', { level: 2 }),
      h3:         e.isActive('heading', { level: 3 }),
      bullet:     e.isActive('bulletList'),
      ordered:    e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      link:       e.isActive('link'),
      image:      e.isActive('image'),
      canUndo:    e.can().undo(),
      canRedo:    e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-slate-200 bg-slate-50 rounded-t-lg">
      <ToolbarButton label="B"   title="Bold"          active={s.bold}       disabled={disabled} onClick={() => chain().toggleBold().run()} />
      <ToolbarButton label="I"   title="Italic"        active={s.italic}     disabled={disabled} onClick={() => chain().toggleItalic().run()} />
      <ToolbarButton label="U"   title="Underline"     active={s.underline}  disabled={disabled} onClick={() => chain().toggleUnderline().run()} />
      <ToolbarButton label="S"   title="Strikethrough" active={s.strike}     disabled={disabled} onClick={() => chain().toggleStrike().run()} />
      <span className="w-px h-5 bg-slate-300 mx-1" />
      <ToolbarButton label="H1"  title="Large heading"  active={s.h1} disabled={disabled} onClick={() => chain().toggleHeading({ level: 1 }).run()} />
      <ToolbarButton label="H2"  title="Medium heading" active={s.h2} disabled={disabled} onClick={() => chain().toggleHeading({ level: 2 }).run()} />
      <ToolbarButton label="H3"  title="Small heading"  active={s.h3} disabled={disabled} onClick={() => chain().toggleHeading({ level: 3 }).run()} />
      <span className="w-px h-5 bg-slate-300 mx-1" />
      <ToolbarButton label="•"   title="Bulleted list" active={s.bullet}     disabled={disabled} onClick={() => chain().toggleBulletList().run()} />
      <ToolbarButton label="1."  title="Numbered list" active={s.ordered}    disabled={disabled} onClick={() => chain().toggleOrderedList().run()} />
      <ToolbarButton label="❝"   title="Quote"         active={s.blockquote} disabled={disabled} onClick={() => chain().toggleBlockquote().run()} />
      <ToolbarButton label="―"   title="Divider line"                        disabled={disabled} onClick={() => chain().setHorizontalRule().run()} />
      <ToolbarButton label="🔗"  title="Link"          active={s.link}       disabled={disabled} onClick={() => setLink(editor)} />
      <ToolbarButton label="🖼"  title="Insert image (or paste / drop one in)" disabled={disabled} onClick={onPickImage} />
      {s.image && <ToolbarButton label="Alt" title="Describe the selected image" disabled={disabled} onClick={() => setImageAlt(editor)} />}
      <span className="w-px h-5 bg-slate-300 mx-1" />
      <ToolbarButton label="↶"   title="Undo" disabled={disabled || !s.canUndo} onClick={() => chain().undo().run()} />
      <ToolbarButton label="↷"   title="Redo" disabled={disabled || !s.canRedo} onClick={() => chain().redo().run()} />
    </div>
  );
}

/** Remount (change its `key`) to clear the content. */
export function RichTextEditor({ onChange, disabled, uploadImage, onImageError }: Props) {
  const editorRef  = useRef<Editor | null>(null);
  const fileInput  = useRef<HTMLInputElement>(null);
  const uploadRef  = useRef(uploadImage);
  const onErrorRef = useRef(onImageError);
  uploadRef.current  = uploadImage;
  onErrorRef.current = onImageError;

  // One at a time, so several images land in order, each at the cursor
  const addImages = useCallback(async (files: File[]) => {
    for (const file of files) {
      try {
        const { src, width } = await uploadRef.current(file);
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return;
        ed.chain().focus().setImage({ src, alt: '', width }).run();
      } catch (err) {
        onErrorRef.current((err as Error).message);
      }
    }
  }, []);

  const editor = useEditor({
    extensions,
    onUpdate: ({ editor: e }) => onChange(e.getHTML(), e.isEmpty),
    editorProps: {
      handlePaste: (_view, event) => {
        const files = pickImageFiles(event.clipboardData?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        addImages(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = moved ? [] : pickImageFiles(event.dataTransfer?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (pos !== undefined) editorRef.current?.commands.setTextSelection(pos);
        addImages(files);
        return true;
      },
    },
  });
  editorRef.current = editor;

  // Toggled in place - recreating the editor would lose the message
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  if (!editor) return null;

  return (
    <div className={`border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-forest-500 ${CONTENT_STYLES}`}>
      <Toolbar editor={editor} disabled={disabled} onPickImage={() => fileInput.current?.click()} />
      <EditorContent editor={editor} />
      <input
        ref={fileInput}
        type="file"
        accept={MAILOUT_IMAGE_TYPES.join(',')}
        multiple
        hidden
        onChange={e => {
          addImages(pickImageFiles(e.target.files));
          e.target.value = ''; // so choosing the same file again still fires
        }}
      />
    </div>
  );
}
