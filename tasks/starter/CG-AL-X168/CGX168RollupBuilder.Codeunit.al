codeunit 71523 "CG X168 Rollup Builder"
{
    procedure BuildRollup(var RollupResult: Record "CG X168 Rollup Result" temporary)
    var
        Group: Record "CG X168 Cost Group";
        OwnAmount: Decimal;
        TotalAmount: Decimal;
    begin
        RollupResult.Reset();
        RollupResult.DeleteAll();
        if Group.FindSet() then
            repeat
                TotalAmount := ComputeGroupTotal(Group."Code", OwnAmount);
                RollupResult.Init();
                RollupResult."Group Code" := Group."Code";
                RollupResult."Own Amount" := OwnAmount;
                RollupResult."Total Amount" := TotalAmount;
                RollupResult.Insert();
            until Group.Next() = 0;
    end;

    local procedure ComputeGroupTotal(GroupCode: Code[20]; var OwnAmountOut: Decimal): Decimal
    var
        ChildGroup: Record "CG X168 Cost Group";
        ChildOwnAmount: Decimal;
        Total: Decimal;
    begin
        OwnAmountOut := ComputeOwnAmount(GroupCode);
        Total := OwnAmountOut;
        ChildGroup.SetRange("Parent Code", GroupCode);
        if ChildGroup.FindSet() then
            repeat
                Total += ComputeGroupTotal(ChildGroup."Code", ChildOwnAmount);
            until ChildGroup.Next() = 0;
        exit(Total);
    end;

    local procedure ComputeOwnAmount(GroupCode: Code[20]): Decimal
    var
        Entry: Record "CG X168 Cost Entry";
    begin
        Entry.SetRange("Group Code", GroupCode);
        Entry.CalcSums(Amount);
        exit(Entry.Amount);
    end;
}
