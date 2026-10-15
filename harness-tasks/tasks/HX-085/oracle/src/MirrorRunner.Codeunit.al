codeunit 87161 "HX085 Mirror Runner"
{
    var
        Steps: List of [Integer];
        Step: Option StartCheckout,StopCheckout,StartReturn,StopReturn,CheckoutOn,CheckoutOff,ReturnOn,ReturnOff;

    procedure AddStep(NewStep: Option StartCheckout,StopCheckout,StartReturn,StopReturn,CheckoutOn,CheckoutOff,ReturnOn,ReturnOff)
    begin
        Steps.Add(NewStep);
    end;

    trigger OnRun()
    var
        CheckoutMirror: Codeunit "CGR Checkout Mirror";
        ReturnMirror: Codeunit "CGR Return Mirror";
        DeskMirror: Codeunit "CGR Desk Mirror";
        StepNo: Integer;
    begin
        foreach StepNo in Steps do begin
            Step := StepNo;
            case Step of
                Step::StartCheckout:
                    CheckoutMirror.StartCheckoutMirror();
                Step::StopCheckout:
                    CheckoutMirror.StopCheckoutMirror();
                Step::StartReturn:
                    ReturnMirror.StartReturnMirror();
                Step::StopReturn:
                    ReturnMirror.StopReturnMirror();
                Step::CheckoutOn:
                    DeskMirror.SetCheckoutMirror(true);
                Step::CheckoutOff:
                    DeskMirror.SetCheckoutMirror(false);
                Step::ReturnOn:
                    DeskMirror.SetReturnMirror(true);
                Step::ReturnOff:
                    DeskMirror.SetReturnMirror(false);
            end;
        end;
    end;
}
