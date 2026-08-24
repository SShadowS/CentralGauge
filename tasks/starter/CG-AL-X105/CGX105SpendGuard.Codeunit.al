codeunit 70653 "CG X105 Spend Guard"
{
    procedure IsWithinLimit(ApproverID: Code[20]; RequestedAmount: Integer): Boolean
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
    begin
        if not ApprovalLookup.GetApprovalLimit(ApproverID, Entry) then
            exit(false);
        exit(RequestedAmount <= Entry."Amount Limit");
    end;
}
