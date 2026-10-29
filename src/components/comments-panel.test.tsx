import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentsPanel } from "@/components/comments-panel";
import type { Comment } from "@/lib/types";

const comments: Comment[] = [
  { id: "1", materialId: "m1", slide: 3, author: "Marina", authorRole: "cliente", body: "Preço errado", createdAt: "2026-10-26T09:00:00-03:00" },
  { id: "2", materialId: "m1", slide: null, author: "Equipe Luvi", authorRole: "luvi", body: "Versão 2 enviada", createdAt: "2026-10-27T09:00:00-03:00" },
];

describe("CommentsPanel", () => {
  it("lista comentários e filtra por slide", async () => {
    render(
      <CommentsPanel comments={comments} totalSlides={6} authorName="Marina" authorRole="cliente" onAdd={vi.fn()} />,
    );
    const list = screen.getByTestId("comment-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Slide 3" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Preço errado")).toBeInTheDocument();
  });

  it("envia comentário para o slide escolhido e limpa o campo", async () => {
    const onAdd = vi.fn();
    render(
      <CommentsPanel comments={[]} totalSlides={6} authorName="Marina" authorRole="cliente" onAdd={onAdd} />,
    );
    const send = screen.getByRole("button", { name: /comentar/i });
    expect(send).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Sobre"), "2");
    await userEvent.type(screen.getByLabelText("Novo comentário"), "  Trocar a foto  ");
    await userEvent.click(send);

    expect(onAdd).toHaveBeenCalledWith(2, "Trocar a foto");
    expect(screen.getByLabelText("Novo comentário")).toHaveValue("");
  });

  it("não oferece seleção de slide para material de página única", () => {
    render(
      <CommentsPanel comments={[]} totalSlides={1} authorName="Marina" authorRole="cliente" onAdd={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Sobre")).not.toBeInTheDocument();
  });
});
