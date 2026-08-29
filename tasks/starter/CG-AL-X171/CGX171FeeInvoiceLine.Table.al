table 71552 "CG X171 Fee Invoice Line"
{
    Caption = 'CG X171 Fee Invoice Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Document No."; Code[20])
        {
            Caption = 'Document No.';
            TableRelation = "CG X171 Fee Invoice"."No.";
        }
        field(2; "Line No."; Integer)
        {
            Caption = 'Line No.';
        }
        field(3; "Item Description"; Text[100])
        {
            Caption = 'Item Description';
        }
        field(10; "Net Amount"; Decimal)
        {
            Caption = 'Net Amount';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
        }
        field(11; "Handling Fee"; Decimal)
        {
            Caption = 'Handling Fee';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Document No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
