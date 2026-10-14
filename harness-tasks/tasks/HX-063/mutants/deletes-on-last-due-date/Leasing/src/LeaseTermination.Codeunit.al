codeunit 70320 "CGR Lease Termination"
{
    var
        BeforeStartErr: Label 'Lease %1 cannot end before it starts.', Comment = '%1 = lease number';
        InvoicedAfterErr: Label 'Lease %1 is invoiced after %2.', Comment = '%1 = lease number, %2 = last due date';

    procedure TerminateLease(ContractNo: Code[20]; LastDueDate: Date)
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        Contract.Get(ContractNo);
        if LastDueDate < Contract."Start Date" then
            Error(BeforeStartErr, ContractNo);
        Line.SetRange("Contract No.", ContractNo);
        Line.SetFilter("Due Date", '>%1', LastDueDate);
        Line.SetRange(Invoiced, true);
        if not Line.IsEmpty() then
            Error(InvoicedAfterErr, ContractNo, Format(LastDueDate, 0, 9));
        Line.SetRange(Invoiced);
        Line.SetFilter("Due Date", '>=%1', LastDueDate);
        Line.DeleteAll(true);

        Line.SetRange("Due Date");
        Contract.Months := Line.Count();
        Contract.Modify(true);

        Line.SetRange(Invoiced, false);
        if Line.FindSet(true) then
            repeat
                Line.Amount := LeaseMgt.MonthlyRate(Contract."Base Rate", Contract.Months);
                Line.Modify(true);
            until Line.Next() = 0;
    end;
}
