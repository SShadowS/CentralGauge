codeunit 70267 "CGR Desk Posting"
{
    var
        LockedErr: Label 'The desk is locked after 3 failed postings. Ask the back office to unlock it.';

    procedure PostAtDesk(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Attempts: Codeunit "CGR Desk Attempts";
    begin
        if Attempts.Failures() >= 3 then
            Error(LockedErr);
        Contract.Get(ContractNo);
        ClearLastError();
        if Codeunit.Run(Codeunit::"CGR Rental-Post", Contract) then begin
            Attempts.Reset();
            exit;
        end;
        Attempts.AddFailure();
    end;
}
