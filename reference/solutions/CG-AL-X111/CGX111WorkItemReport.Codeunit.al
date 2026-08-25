codeunit 70711 "CG X111 Work Item Report"
{
    // Walks a work item's checklist tree to report on everything nested
    // beneath a given item, at any depth.

    procedure CountOpenSubItems(ParentNo: Code[20]): Integer
    var
        ChildItem: Record "CG X111 Work Item";
        OpenCount: Integer;
    begin
        if not FindChildren(ChildItem, ParentNo) then
            exit(0);

        repeat
            if ChildItem.Status = ChildItem.Status::Open then
                OpenCount += 1;
            OpenCount += CountOpenSubItems(ChildItem."No.");
        until ChildItem.Next() = 0;

        exit(OpenCount);
    end;

    procedure TotalEstimatedHours(ParentNo: Code[20]): Decimal
    var
        ChildItem: Record "CG X111 Work Item";
        HoursTotal: Decimal;
    begin
        if not FindChildren(ChildItem, ParentNo) then
            exit(0);

        repeat
            HoursTotal += ChildItem."Estimated Hours";
            HoursTotal += TotalEstimatedHours(ChildItem."No.");
        until ChildItem.Next() = 0;

        exit(HoursTotal);
    end;

    procedure OpenSubItemHoursAcrossChecklist(): Decimal
    var
        Item: Record "CG X111 Work Item";
        Total: Decimal;
    begin
        if Item.FindSet() then
            repeat
                if (Item."Parent No." <> '') and (Item.Status = Item.Status::Open) then
                    Total += Item."Estimated Hours";
            until Item.Next() = 0;

        exit(Total);
    end;

    local procedure FindChildren(var ChildItem: Record "CG X111 Work Item"; ParentNo: Code[20]): Boolean
    begin
        ChildItem.Reset();
        ChildItem.SetCurrentKey("Sort Order");
        ChildItem.SetRange("Parent No.", ParentNo);
        exit(ChildItem.FindSet());
    end;
}
