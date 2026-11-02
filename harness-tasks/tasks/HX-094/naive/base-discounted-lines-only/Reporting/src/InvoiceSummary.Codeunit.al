codeunit 70533 "CGR Invoice Summary"
{
    procedure Build(InvoiceNo: Code[20]; var Header: Record "CGR Invoice Summary Header" temporary; var Lines: Record "CGR Invoice Summary Line" temporary)
    var
        Invoice: Record "CGR Rental Invoice";
        InvoiceLine: Record "CGR Rental Invoice Line";
        GroupNet: Dictionary of [Code[10], Decimal];
        GroupBase: Dictionary of [Code[10], Decimal];
        TaxGroupCode: Code[10];
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
                if InvoiceLine."Discount Amount" <> 0 then
                    Accumulate(GroupBase, InvoiceLine."Tax Group Code", InvoiceLine."Line Amount")
                else
                    Accumulate(GroupBase, InvoiceLine."Tax Group Code", 0);
                Accumulate(GroupNet, InvoiceLine."Tax Group Code", InvoiceLine."Discount Amount");
            until InvoiceLine.Next() = 0;

        foreach TaxGroupCode in SortedKeys(GroupNet) do
            AddGroup(Header, Lines, TaxGroupCode, GroupBase.Get(TaxGroupCode), GroupNet.Get(TaxGroupCode));

        if Invoice."Handling Fee" <> 0 then begin
            AddLine(Lines, "CGR Summary Line Type"::Charge, 'FEE', '', 0, Invoice."Handling Fee");
            Header."Charge Total" += Invoice."Handling Fee";
        end;

        Header."Total Excl. Tax" := Header."Line Total" - Header."Discount Total" + Header."Charge Total";
        Header.Insert();
    end;

    local procedure AddGroup(var Header: Record "CGR Invoice Summary Header" temporary; var Lines: Record "CGR Invoice Summary Line" temporary; TaxGroupCode: Code[10]; GroupBase: Decimal; GroupNet: Decimal)
    begin
        if GroupNet > 0 then begin
            AddLine(Lines, "CGR Summary Line Type"::Discount, 'DISC', TaxGroupCode, GroupBase, GroupNet);
            Header."Discount Total" += GroupNet;
        end;
        if GroupNet < 0 then begin
            AddLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', TaxGroupCode, GroupBase, -GroupNet);
            Header."Charge Total" += -GroupNet;
        end;
    end;

    local procedure Accumulate(var Totals: Dictionary of [Code[10], Decimal]; TaxGroupCode: Code[10]; Value: Decimal)
    begin
        if Totals.ContainsKey(TaxGroupCode) then
            Totals.Set(TaxGroupCode, Totals.Get(TaxGroupCode) + Value)
        else
            Totals.Add(TaxGroupCode, Value);
    end;

    local procedure SortedKeys(Totals: Dictionary of [Code[10], Decimal]) Sorted: List of [Code[10]]
    var
        TaxGroupCode: Code[10];
        i: Integer;
        Done: Boolean;
    begin
        foreach TaxGroupCode in Totals.Keys() do begin
            i := 1;
            Done := false;
            while not Done do
                if i > Sorted.Count() then
                    Done := true
                else
                    if Sorted.Get(i) < TaxGroupCode then
                        i += 1
                    else
                        Done := true;
            if i > Sorted.Count() then
                Sorted.Add(TaxGroupCode)
            else
                Sorted.Insert(i, TaxGroupCode);
        end;
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
