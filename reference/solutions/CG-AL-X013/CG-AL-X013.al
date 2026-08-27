codeunit 71020 "CG X013 Joiner"
{
    Access = Internal;

    procedure Combine(Prefix: Code[10]; Suffix: Code[10]): Code[20]
    begin
        exit(Prefix + Suffix);
    end;
}