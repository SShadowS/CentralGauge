codeunit 69998 "CG X051 Engine"
{
    // Settles the given account: posts its own regular (Normal) and
    // Adjustment entries for the day, AND an additional Normal entry for
    // the NEXT account in a fixed settlement cycle (A -> B -> C -> A) - a
    // balancing side-effect of double-entry settlement the caller does not
    // request explicitly. Touches ONLY the entry table, never Account rows,
    // so a model-side Account iteration can never be invalidated mid-loop.
    procedure Settle(AccountNo: Code[20])
    var
        NextAccountNo: Code[20];
        OwnAmount: Integer;
        AdjustmentAmount: Integer;
        CarryAmount: Integer;
    begin
        case AccountNo of
            'A':
                begin
                    NextAccountNo := 'B';
                    OwnAmount := 34;
                    AdjustmentAmount := -9;
                    CarryAmount := 16;
                end;
            'B':
                begin
                    NextAccountNo := 'C';
                    OwnAmount := 21;
                    AdjustmentAmount := 14;
                    CarryAmount := 25;
                end;
            'C':
                begin
                    NextAccountNo := 'A';
                    OwnAmount := 42;
                    AdjustmentAmount := -17;
                    CarryAmount := 30;
                end;
            else
                Error('CG X051 Engine: unknown account %1', AccountNo);
        end;

        InsertEntry(AccountNo, "CG X051 Kind"::Normal, OwnAmount);
        InsertEntry(AccountNo, "CG X051 Kind"::Adjustment, AdjustmentAmount);
        InsertEntry(NextAccountNo, "CG X051 Kind"::Normal, CarryAmount);
    end;

    local procedure InsertEntry(AccountNo: Code[20]; Kind: Enum "CG X051 Kind"; Amount: Integer)
    var
        Entry: Record "CG X051 Entry";
        NewEntryNo: Integer;
    begin
        Entry.Reset();
        if Entry.FindLast() then
            NewEntryNo := Entry."Entry No." + 1
        else
            NewEntryNo := 1;

        Entry.Init();
        Entry."Entry No." := NewEntryNo;
        Entry."Account No." := AccountNo;
        Entry.Kind := Kind;
        Entry.Amount := Amount;
        Entry.Insert();
    end;
}
