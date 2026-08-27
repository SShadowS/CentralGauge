codeunit 71190 "CG X030 Deadline Calc"
{
    Access = Internal;

    procedure ComputeDeadline(LeadTimeDays: Integer): Date
    begin
        exit(Today() + LeadTimeDays);
    end;
}