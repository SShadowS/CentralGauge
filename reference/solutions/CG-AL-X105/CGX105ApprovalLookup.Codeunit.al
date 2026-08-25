codeunit 70652 "CG X105 Approval Lookup"
{
    procedure GetApprovalLimit(ApproverID: Code[20]; var Entry: Record "CG X105 Approval Entry"): Boolean
    begin
        Entry.Reset();
        Entry.SetCurrentKey("Approver ID", Status);
        Entry.SetRange("Approver ID", ApproverID);
        Entry.SetRange(Status, Entry.Status::Approved);
        exit(Entry.FindFirst());
    end;
}
