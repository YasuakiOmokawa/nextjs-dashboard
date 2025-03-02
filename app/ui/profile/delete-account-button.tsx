"use client";

import { Button } from "../button";

export default function DeleteAccountButton() {
  const handleClick = () => alert("本当によろしいですか？");

  return <Button onClick={handleClick}>delete your account</Button>;
}
