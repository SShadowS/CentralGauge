codeunit 70855 "CG X125 Refund Releaser"
{
    var
        NeedsApprovalQst: Label 'Refund request %1 needs approval before release. Release it anyway?';

    procedure ReleaseRefund(var Req: Record "CG X125 Refund Request"): Boolean
    var
        Classifier: Codeunit "CG X125 Customer Classifier";
    begin
        if (Req.Amount > ApprovalThreshold()) and Classifier.NeedsScrutiny(Req."Customer No.") then begin
            if not Confirm(StrSubstNo(NeedsApprovalQst, Req."Entry No."), false) then begin
                LogDecline(Req);
                exit(false);
            end;

            Req.Status := Req.Status::Released;
            Req."Manual Overrides" += 1;
            Req.Modify();
            exit(true);
        end;

        Req.Status := Req.Status::Released;
        Req.Modify();
        exit(true);
    end;

    local procedure ApprovalThreshold(): Integer
    var
        Policy: Record "CG X125 Refund Policy";
    begin
        if not Policy.Get('') then begin
            Policy.Init();
            Policy."Primary Key" := '';
            Policy."Approval Threshold" := 500;
            Policy.Insert();
        end;
        exit(Policy."Approval Threshold");
    end;

    local procedure LogDecline(Req: Record "CG X125 Refund Request")
    var
        Log: Record "CG X125 Decline Log";
        NextNo: Integer;
    begin
        Log.Reset();
        if Log.FindLast() then
            NextNo := Log."Entry No." + 1
        else
            NextNo := 1;

        Log.Init();
        Log."Entry No." := NextNo;
        Log."Customer No." := Req."Customer No.";
        Log.Amount := Req.Amount;
        Log.Insert();
    end;
}
