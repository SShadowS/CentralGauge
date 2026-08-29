codeunit 71523 "CG X168 Rollup Builder"
{
    procedure BuildRollup(var RollupResult: Record "CG X168 Rollup Result" temporary)
    var
        ChildrenMap: Dictionary of [Code[20], List of [Code[20]]];
        OwnAmounts: Dictionary of [Code[20], Decimal];
        TotalAmounts: Dictionary of [Code[20], Decimal];
        AllCodes: List of [Code[20]];
        GroupCode: Code[20];
        OwnAmount: Decimal;
    begin
        RollupResult.Reset();
        RollupResult.DeleteAll();

        LoadChildrenMap(ChildrenMap, AllCodes);
        LoadOwnAmounts(OwnAmounts);

        foreach GroupCode in AllCodes do begin
            if OwnAmounts.ContainsKey(GroupCode) then
                OwnAmount := OwnAmounts.Get(GroupCode)
            else
                OwnAmount := 0;
            RollupResult.Init();
            RollupResult."Group Code" := GroupCode;
            RollupResult."Own Amount" := OwnAmount;
            RollupResult."Total Amount" := GroupTotal(GroupCode, ChildrenMap, OwnAmounts, TotalAmounts);
            RollupResult.Insert();
        end;
    end;

    local procedure LoadChildrenMap(var ChildrenMap: Dictionary of [Code[20], List of [Code[20]]]; var AllCodes: List of [Code[20]])
    var
        Group: Record "CG X168 Cost Group";
        ChildList: List of [Code[20]];
    begin
        if Group.FindSet() then
            repeat
                AllCodes.Add(Group."Code");
                if Group."Parent Code" <> '' then begin
                    if ChildrenMap.ContainsKey(Group."Parent Code") then
                        ChildList := ChildrenMap.Get(Group."Parent Code")
                    else
                        Clear(ChildList);
                    ChildList.Add(Group."Code");
                    ChildrenMap.Set(Group."Parent Code", ChildList);
                end;
            until Group.Next() = 0;
    end;

    local procedure LoadOwnAmounts(var OwnAmounts: Dictionary of [Code[20], Decimal])
    var
        Entry: Record "CG X168 Cost Entry";
        CurrentAmount: Decimal;
    begin
        if Entry.FindSet() then
            repeat
                if OwnAmounts.ContainsKey(Entry."Group Code") then begin
                    CurrentAmount := OwnAmounts.Get(Entry."Group Code");
                    OwnAmounts.Set(Entry."Group Code", CurrentAmount + Entry.Amount);
                end else
                    OwnAmounts.Add(Entry."Group Code", Entry.Amount);
            until Entry.Next() = 0;
    end;

    local procedure GroupTotal(GroupCode: Code[20]; var ChildrenMap: Dictionary of [Code[20], List of [Code[20]]]; var OwnAmounts: Dictionary of [Code[20], Decimal]; var TotalAmounts: Dictionary of [Code[20], Decimal]): Decimal
    var
        ChildList: List of [Code[20]];
        ChildCode: Code[20];
        OwnAmount: Decimal;
        Total: Decimal;
    begin
        if TotalAmounts.ContainsKey(GroupCode) then
            exit(TotalAmounts.Get(GroupCode));

        if OwnAmounts.ContainsKey(GroupCode) then
            OwnAmount := OwnAmounts.Get(GroupCode)
        else
            OwnAmount := 0;
        Total := OwnAmount;

        if ChildrenMap.ContainsKey(GroupCode) then begin
            ChildList := ChildrenMap.Get(GroupCode);
            foreach ChildCode in ChildList do
                Total += GroupTotal(ChildCode, ChildrenMap, OwnAmounts, TotalAmounts);
        end;

        TotalAmounts.Add(GroupCode, Total);
        exit(Total);
    end;
}
