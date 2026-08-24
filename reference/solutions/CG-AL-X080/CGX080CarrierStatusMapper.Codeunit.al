codeunit 70453 "CG X080 Carrier Status Mapper"
{
    // Translates the integer status codes the carrier's tracking API returns
    // into our internal status enum, and back again when we report status
    // upstream to the carrier's own systems.

    procedure FromWire(WireCode: Integer): Enum "CG X080 Carrier Status"
    var
        Status: Enum "CG X080 Carrier Status";
    begin
        if not Status.Ordinals().Contains(WireCode) then
            exit("CG X080 Carrier Status"::Unknown);
        exit(Enum::"CG X080 Carrier Status".FromInteger(WireCode));
    end;

    procedure ToWire(Status: Enum "CG X080 Carrier Status"): Integer
    begin
        exit(Status.AsInteger());
    end;
}
