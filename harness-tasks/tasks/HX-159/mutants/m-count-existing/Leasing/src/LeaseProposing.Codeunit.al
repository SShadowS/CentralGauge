codeunit 70382 "CGR Lease Proposing"
{
    procedure Propose(ContractNo: Code[20]; UpToDate: Date): Integer
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Proposal: Record "CGR Lease Proposal Line";
        Created: Integer;
    begin
        Contract.Get(ContractNo);
        if Contract."Proposed Through" >= UpToDate then
            exit(0);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        if Contract."Proposed Through" = 0D then
            ScheduleLine.SetFilter("Due Date", '..%1', UpToDate)
        else
            ScheduleLine.SetFilter("Due Date", '%1..%2', Contract."Proposed Through" + 1, UpToDate);
        if ScheduleLine.FindSet() then
            repeat
                if not Proposal.Get(ContractNo, ScheduleLine."Line No.") then begin
                    Proposal.Init();
                    Proposal."Contract No." := ContractNo;
                    Proposal."Schedule Line No." := ScheduleLine."Line No.";
                    Proposal."Due Date" := ScheduleLine."Due Date";
                    Proposal.Amount := ScheduleLine.Amount;
                    Proposal.Insert();
                end;
                Created += 1;
            until ScheduleLine.Next() = 0;
        Contract."Proposed Through" := UpToDate;
        Contract.Modify();
        exit(Created);
    end;

    procedure PostProposal(ContractNo: Code[20]; ScheduleLineNo: Integer)
    var
        Proposal: Record "CGR Lease Proposal Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        Proposal.Get(ContractNo, ScheduleLineNo);
        LeaseMgt.InvoiceLine(ContractNo, ScheduleLineNo);
        Proposal.Delete();
    end;
}
