codeunit 71060 "CG X017 Calculator"
{
    Access = Internal;

    procedure ComputeInto(Input: Integer; var Result: Integer): Boolean
    begin
        Result := (Input * 6) + 4;
        exit(true);
    end;
}