interface "Shipping Provider"
{
    procedure CalculateShippingCost(Weight: Decimal; FromCountry: Text; ToCountry: Text): Decimal;
    procedure EstimateDeliveryTime(FromCountry: Text; ToCountry: Text; ServiceType: Text): Integer;
    procedure CreateShipment(OrderNumber: Text; FromAddress: Text; ToAddress: Text; Weight: Decimal): Text[50];
    procedure TrackShipment(TrackingNumber: Text): Text[100];
    procedure ValidateAddress(Street: Text; City: Text; State: Text; ZipCode: Text; Country: Text): Boolean;
}

codeunit 70004 "Standard Shipping Provider" implements "Shipping Provider"
{
    var
        BaseRateLcl: Decimal;
        BaseRateIntl: Decimal;
        WeightRatePerKg: Decimal;

        InvalidWeightErr: Label 'Weight must be greater than zero.';
        InvalidCountryErr: Label 'Country information must be provided.';
        InvalidOrderErr: Label 'Order number must be provided.';
        InvalidAddressErr: Label 'Address information is invalid or incomplete.';
        InvalidTrackingErr: Label 'Tracking number must be provided.';
        InvalidServiceTypeErr: Label 'Service type must be either Standard or Express.';

    trigger OnRun()
    begin
        BaseRateLcl := 10.00;
        BaseRateIntl := 35.00;
        WeightRatePerKg := 2.50;
    end;

    procedure CalculateShippingCost(Weight: Decimal; FromCountry: Text; ToCountry: Text): Decimal
    var
        Cost: Decimal;
        BaseRate: Decimal;
        WeightMultiplier: Decimal;
    begin
        if Weight <= 0 then
            Error(InvalidWeightErr);
        if (FromCountry = '') or (ToCountry = '') then
            Error(InvalidCountryErr);

        if UpperCase(FromCountry) = UpperCase(ToCountry) then
            BaseRate := 10.00
        else
            BaseRate := 35.00;

        case true of
            Weight <= 1:
                WeightMultiplier := 1.0;
            Weight <= 5:
                WeightMultiplier := 1.5;
            Weight <= 20:
                WeightMultiplier := 2.0;
            Weight <= 50:
                WeightMultiplier := 3.0;
            else
                WeightMultiplier := 4.5;
        end;

        Cost := BaseRate + (Weight * 2.50 * WeightMultiplier);
        LogAuditTrail(StrSubstNo('CalculateShippingCost: Weight=%1, From=%2, To=%3, Cost=%4',
            Weight, FromCountry, ToCountry, Cost));
        exit(Round(Cost, 0.01));
    end;

    procedure EstimateDeliveryTime(FromCountry: Text; ToCountry: Text; ServiceType: Text): Integer
    var
        Days: Integer;
        IsDomestic: Boolean;
    begin
        if (FromCountry = '') or (ToCountry = '') then
            Error(InvalidCountryErr);

        if not (UpperCase(ServiceType) in ['STANDARD', 'EXPRESS']) then
            Error(InvalidServiceTypeErr);

        IsDomestic := UpperCase(FromCountry) = UpperCase(ToCountry);

        case UpperCase(ServiceType) of
            'EXPRESS':
                if IsDomestic then
                    Days := 1
                else
                    Days := 3;
            'STANDARD':
                if IsDomestic then
                    Days := 5
                else
                    Days := 10;
        end;

        LogAuditTrail(StrSubstNo('EstimateDeliveryTime: From=%1, To=%2, Service=%3, Days=%4',
            FromCountry, ToCountry, ServiceType, Days));
        exit(Days);
    end;

    procedure CreateShipment(OrderNumber: Text; FromAddress: Text; ToAddress: Text; Weight: Decimal): Text[50]
    var
        TrackingNumber: Text[50];
    begin
        if OrderNumber = '' then
            Error(InvalidOrderErr);
        if (FromAddress = '') or (ToAddress = '') then
            Error(InvalidAddressErr);
        if Weight <= 0 then
            Error(InvalidWeightErr);

        TrackingNumber := 'SSP-' + Format(CurrentDateTime, 0, '<Year4><Month,2><Day,2><Hours24,2><Minutes,2><Seconds,2>') +
            '-' + CopyStr(OrderNumber, 1, 10);

        LogAuditTrail(StrSubstNo('CreateShipment: Order=%1, Tracking=%2, Weight=%3',
            OrderNumber, TrackingNumber, Weight));
        exit(TrackingNumber);
    end;

    procedure TrackShipment(TrackingNumber: Text): Text[100]
    var
        Status: Text[100];
        HashVal: Integer;
    begin
        if TrackingNumber = '' then
            Error(InvalidTrackingErr);

        HashVal := StrLen(TrackingNumber) mod 5;
        case HashVal of
            0:
                Status := 'Shipment created - awaiting pickup';
            1:
                Status := 'Picked up - in transit to sorting facility';
            2:
                Status := 'In transit - at regional hub';
            3:
                Status := 'Out for delivery';
            4:
                Status := 'Delivered to recipient';
        end;

        LogAuditTrail(StrSubstNo('TrackShipment: Tracking=%1, Status=%2', TrackingNumber, Status));
        exit(Status);
    end;

    procedure ValidateAddress(Street: Text; City: Text; State: Text; ZipCode: Text; Country: Text): Boolean
    var
        IsValid: Boolean;
    begin
        IsValid := true;

        if (Street = '') or (StrLen(Street) < 3) then
            IsValid := false;
        if (City = '') or (StrLen(City) < 2) then
            IsValid := false;
        if State = '' then
            IsValid := false;
        if (ZipCode = '') or (StrLen(ZipCode) < 3) then
            IsValid := false;
        if (Country = '') or (StrLen(Country) < 2) then
            IsValid := false;

        LogAuditTrail(StrSubstNo('ValidateAddress: Street=%1, City=%2, State=%3, Zip=%4, Country=%5, Valid=%6',
            Street, City, State, ZipCode, Country, IsValid));
        exit(IsValid);
    end;

    local procedure LogAuditTrail(LogMessage: Text)
    begin
        Session.LogMessage('SSP0001', LogMessage, Verbosity::Normal, DataClassification::SystemMetadata,
            TelemetryScope::ExtensionPublisher, 'Category', 'StandardShippingProvider');
    end;
}