import { redirect } from "next/navigation";

// トップは外為オプション（GMO）の画面へ。旧「◯分後」予測は /legacy に残しています。
export default function Home() {
  redirect("/gmo");
}
