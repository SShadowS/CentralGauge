page 50201 "UI Sample Editable Caption Bad"
{
    PageType = Card;
    SourceTable = Customer;

    layout
    {
        area(Content)
        {
            field("Customer Name"; Rec.Name)
            {
                ApplicationArea = All;
                ShowCaption = false;
                InstructionalText = 'Enter the customer name';
            }
            field("Dynamic Editable"; Rec."No.")
            {
                ApplicationArea = All;
                Editable = IsEditable;
                ShowCaption = false;
            }
        }
    }

    var
        IsEditable: Boolean;
}
