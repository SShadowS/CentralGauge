codeunit 70994 "CG X139 Adjustment Poster"
{
    procedure PostAdjustments(DocumentNo: Code[20])
    var
        AdjLine: Record "CG X139 Adjustment Line";
    begin
        AdjLine.SetRange("Document No.", DocumentNo);
        if AdjLine.FindSet() then
            repeat
                case AdjLine."Adjustment Type" of
                    "CG X139 Adjustment Type"::Increase:
                        PostIncrease(AdjLine);
                    "CG X139 Adjustment Type"::Decrease:
                        PostDecrease(AdjLine);
                    "CG X139 Adjustment Type"::Revalue:
                        PostRevalue(AdjLine);
                end;
            until AdjLine.Next() = 0;
    end;

    procedure GetBalance(ItemNo: Code[20]; LocationCode: Code[10]): Decimal
    var
        Balance: Record "CG X139 Item Balance";
    begin
        if not Balance.Get(ItemNo, LocationCode) then
            exit(0);
        exit(Balance.Quantity);
    end;

    local procedure PostIncrease(var AdjLine: Record "CG X139 Adjustment Line")
    begin
        InsertEntry(AdjLine, AdjLine."Location Code", AdjLine.Quantity);
        AdjustBalance(AdjLine."Item No.", AdjLine."Location Code", AdjLine.Quantity);
    end;

    local procedure PostDecrease(var AdjLine: Record "CG X139 Adjustment Line")
    begin
        InsertEntry(AdjLine, AdjLine."Location Code", -AdjLine.Quantity);
        AdjustBalance(AdjLine."Item No.", AdjLine."Location Code", -AdjLine.Quantity);
    end;

    local procedure PostRevalue(var AdjLine: Record "CG X139 Adjustment Line")
    var
        CurrentQuantity: Decimal;
        Delta: Decimal;
    begin
        CurrentQuantity := GetBalance(AdjLine."Item No.", AdjLine."Location Code");
        Delta := AdjLine.Quantity - CurrentQuantity;
        InsertEntry(AdjLine, AdjLine."Location Code", Delta);
        SetBalance(AdjLine."Item No.", AdjLine."Location Code", AdjLine.Quantity);
    end;

    local procedure InsertEntry(var AdjLine: Record "CG X139 Adjustment Line"; LocationCode: Code[10]; EntryQuantity: Decimal)
    var
        LedgerEntry: Record "CG X139 Item Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Document No." := AdjLine."Document No.";
        LedgerEntry."Line No." := AdjLine."Line No.";
        LedgerEntry."Item No." := AdjLine."Item No.";
        LedgerEntry."Location Code" := LocationCode;
        LedgerEntry.Quantity := EntryQuantity;
        LedgerEntry.Insert(true);
    end;

    local procedure AdjustBalance(ItemNo: Code[20]; LocationCode: Code[10]; DeltaQuantity: Decimal)
    var
        Balance: Record "CG X139 Item Balance";
    begin
        if not Balance.Get(ItemNo, LocationCode) then begin
            Balance.Init();
            Balance."Item No." := ItemNo;
            Balance."Location Code" := LocationCode;
            Balance.Insert();
        end;
        Balance.Quantity += DeltaQuantity;
        Balance.Modify();
    end;

    local procedure SetBalance(ItemNo: Code[20]; LocationCode: Code[10]; NewQuantity: Decimal)
    var
        Balance: Record "CG X139 Item Balance";
    begin
        if not Balance.Get(ItemNo, LocationCode) then begin
            Balance.Init();
            Balance."Item No." := ItemNo;
            Balance."Location Code" := LocationCode;
            Balance.Insert();
        end;
        Balance.Quantity := NewQuantity;
        Balance.Modify();
    end;
}
