codeunit 70533 "CGR Invoice Summary"
{
    procedure Build(InvoiceNo: Code[20]; var Header: Record "CGR Invoice Summary Header" temporary; var Lines: Record "CGR Invoice Summary Line" temporary)
    var
        Invoice: Record "CGR Rental Invoice";
        InvoiceLine: Record "CGR Rental Invoice Line";
    begin
        Header.Reset();
        Header.DeleteAll();
        Lines.Reset();
        Lines.DeleteAll();

        Invoice.Get(InvoiceNo);
        Header.Init();
        Header."Invoice No." := InvoiceNo;

        InvoiceLine.SetRange("Invoice No.", InvoiceNo);
        if InvoiceLine.FindSet() then
            repeat
                Header."Line Total" += InvoiceLine."Line Amount";
                if InvoiceLine."Discount Amount" > 0 then begin
                    AddLine(Lines, "CGR Summary Line Type"::Discount, 'DISC', InvoiceLine."Tax Group Code", InvoiceLine."Line Amount", InvoiceLine."Discount Amount");
                    Header."Discount Total" += InvoiceLine."Discount Amount";
                end;
                if InvoiceLine."Discount Amount" < 0 then begin
                    AddLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', InvoiceLine."Tax Group Code", InvoiceLine."Line Amount", -InvoiceLine."Discount Amount");
                    Header."Charge Total" += -InvoiceLine."Discount Amount";
                end;
            until InvoiceLine.Next() = 0;

        if Invoice."Handling Fee" <> 0 then begin
            AddLine(Lines, "CGR Summary Line Type"::Charge, 'FEE', '', 0, Invoice."Handling Fee");
            Header."Charge Total" += Invoice."Handling Fee";
        end;

        Header."Total Excl. Tax" := Header."Line Total" - Header."Discount Total" + Header."Charge Total";
        Header.Insert();
    end;

    local procedure AddLine(var Lines: Record "CGR Invoice Summary Line" temporary; LineType: Enum "CGR Summary Line Type"; ReasonCode: Code[10]; TaxGroupCode: Code[10]; BaseAmount: Decimal; LineAmount: Decimal)
    var
        LineNo: Integer;
    begin
        Lines.Reset();
        if Lines.FindLast() then
            LineNo := Lines."Line No.";
        Lines.Init();
        Lines."Line No." := LineNo + 10000;
        Lines."Line Type" := LineType;
        Lines."Reason Code" := ReasonCode;
        Lines."Tax Group Code" := TaxGroupCode;
        Lines."Base Amount" := BaseAmount;
        Lines.Amount := LineAmount;
        Lines.Insert();
    end;
}
