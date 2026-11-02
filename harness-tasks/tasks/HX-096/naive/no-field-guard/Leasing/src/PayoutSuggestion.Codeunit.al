codeunit 70340 "CGR Payout Suggestion"
{
    // Proposes the monthly owner payouts: one line per open statement due by the cutoff, plus one
    // line per third-party share paid in this run.
    procedure Suggest(CutoffDate: Date)
    var
        StatementLine: Record "CGR Owner Statement Line";
        Share: Record "CGR Third-Party Share";
        PayoutLine: Record "CGR Payout Line";
        LineNo: Integer;
        ShareTotal: Decimal;
    begin
        PayoutLine.DeleteAll();
        StatementLine.SetRange(Open, true);
        StatementLine.SetRange("Due Date", 0D, CutoffDate);
        if StatementLine.FindSet() then
            repeat
                // Every open share is owed to its payee, held or not, due or not.
                ShareTotal := 0;
                Share.Reset();
                Share.SetRange("Statement Entry No.", StatementLine."Entry No.");
                Share.SetRange(Open, true);
                if Share.FindSet() then
                    repeat
                        ShareTotal += Share.Amount;
                    until Share.Next() = 0;
                InsertLine(LineNo, StatementLine."Entry No.", 0, StatementLine."Owner Code", StatementLine.Amount - ShareTotal,
                    not OnlyHeldSharesRemain(StatementLine."Entry No."));
                Share.SetRange("On Hold", false);
                Share.SetRange("Due Date", 0D, CutoffDate);
                if Share.FindSet() then
                    repeat
                        InsertLine(LineNo, StatementLine."Entry No.", Share."Line No.", Share."Payee Code", Share.Amount, true);
                    until Share.Next() = 0;
            until StatementLine.Next() = 0;
    end;

    // Switches To Be Paid on a payout line, refusing an owner line whose open shares are all held.
    procedure SetToBePaid(var PayoutLine: Record "CGR Payout Line"; ToBePaid: Boolean)
    begin
        if ToBePaid and (PayoutLine."Share Line No." = 0) then
            if OnlyHeldSharesRemain(PayoutLine."Statement Entry No.") then
                Error(SharesOnHoldErr, PayoutLine."Statement Entry No.");
        PayoutLine."To Be Paid" := ToBePaid;
        PayoutLine.Modify();
    end;

    // True when the statement has open shares and every one of them is on hold.
    procedure OnlyHeldSharesRemain(StatementEntryNo: Integer): Boolean
    var
        Share: Record "CGR Third-Party Share";
    begin
        Share.SetRange("Statement Entry No.", StatementEntryNo);
        Share.SetRange(Open, true);
        if Share.IsEmpty() then
            exit(false);
        Share.SetRange("On Hold", false);
        exit(Share.IsEmpty());
    end;

    local procedure InsertLine(var LineNo: Integer; StatementEntryNo: Integer; ShareLineNo: Integer; PayeeCode: Code[20]; LineAmount: Decimal; ToBePaid: Boolean)
    var
        PayoutLine: Record "CGR Payout Line";
    begin
        LineNo += 1;
        PayoutLine.Init();
        PayoutLine."Line No." := LineNo;
        PayoutLine."Statement Entry No." := StatementEntryNo;
        PayoutLine."Share Line No." := ShareLineNo;
        PayoutLine."Payee Code" := PayeeCode;
        PayoutLine.Amount := LineAmount;
        PayoutLine."To Be Paid" := ToBePaid;
        PayoutLine.Insert();
    end;

    var
        SharesOnHoldErr: Label 'Statement %1 cannot be paid while all of its open third-party shares are on hold.', Comment = '%1 = statement entry no.';
}
