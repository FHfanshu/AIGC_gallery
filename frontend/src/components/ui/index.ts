// UI 组件桶文件（barrel export）
// 统一导出所有 UI 原语，方便其他模块按需导入

export { Button } from './Button';
export { Card } from './Card';
export { Input } from './Input';
export { Textarea } from './Textarea';
export { Tag } from './Tag';

// 向后兼容的 Neu* 前缀别名（旧代码可能使用 NeuButton 等名称）
export { Button as NeuButton } from './Button';
export { Card as NeuCard } from './Card';
export { Input as NeuInput } from './Input';
export { Textarea as NeuTextarea } from './Textarea';
export { Tag as NeuTag } from './Tag';
