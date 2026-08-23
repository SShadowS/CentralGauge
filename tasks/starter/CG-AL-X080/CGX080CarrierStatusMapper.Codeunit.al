codeunit 70453 "CG X080 Carrier Status Mapper"
{
    // Translates the integer status codes the carrier's tracking API returns
    // into our internal status enum, and back again when we report status
    // upstream to the carrier's own systems.

    procedure FromWire(WireCode: Integer): Enum "CG X080 Carrier Status"
    begin
        case WireCode of
            10:
                exit("CG X080 Carrier Status"::Registered);
            20:
                exit("CG X080 Carrier Status"::"In Transit");
            30:
                exit("CG X080 Carrier Status"::Delivered);
            else
                exit("CG X080 Carrier Status"::Unknown);
        end;
    end;

    procedure ToWire(Status: Enum "CG X080 Carrier Status"): Integer
    begin
        exit(Status.AsInteger());
    end;
}
