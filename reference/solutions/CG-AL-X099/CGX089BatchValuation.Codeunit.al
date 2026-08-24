codeunit 70542 "CG X089 Batch Valuation"
{
    procedure ValueByItem(TemplateName: Code[10]; BatchName: Code[10]): Dictionary of [Code[20], Decimal]
    var
        Item: Record "CG X089 Item";
        JnlLine: Record "CG X089 Journal Line";
        QtyByItem: Dictionary of [Code[20], Decimal];
        Totals: Dictionary of [Code[20], Decimal];
        ItemFilter: TextBuilder;
        ItemNo: Code[20];
    begin
        JnlLine.SetRange("Template Name", TemplateName);
        JnlLine.SetRange("Batch Name", BatchName);
        JnlLine.SetLoadFields("Item No.", Quantity);
        if JnlLine.FindSet() then
            repeat
                if QtyByItem.ContainsKey(JnlLine."Item No.") then
                    QtyByItem.Set(JnlLine."Item No.", QtyByItem.Get(JnlLine."Item No.") + JnlLine.Quantity)
                else
                    QtyByItem.Add(JnlLine."Item No.", JnlLine.Quantity);
            until JnlLine.Next() = 0;
        if QtyByItem.Count() = 0 then
            exit(Totals);

        foreach ItemNo in QtyByItem.Keys() do begin
            if ItemFilter.Length() > 0 then
                ItemFilter.Append('|');
            ItemFilter.Append('''' + ItemNo + '''');
        end;
        Item.SetLoadFields("Unit Price");
        Item.SetFilter("No.", ItemFilter.ToText());
        if Item.FindSet() then
            repeat
                Totals.Add(Item."No.", QtyByItem.Get(Item."No.") * Item."Unit Price");
            until Item.Next() = 0;
        exit(Totals);
    end;
}
