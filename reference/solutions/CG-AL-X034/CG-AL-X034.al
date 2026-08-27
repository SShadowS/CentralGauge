codeunit 71230 "CG X034 Status Mapper"
{
    Access = Internal;

    procedure StatusToken(Status: Enum "CG X034 Status"): Text
    begin
        exit(Status.Names.Get(Status.Ordinals.IndexOf(Status.AsInteger())));
    end;
}